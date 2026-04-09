import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// TF-IDF style embedding - must match agent-chat exactly
function betterEmbed(text: string): number[] {
  const vec = new Array(384).fill(0);
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  const wordCount: Record<string, number> = {};
  for (const w of words) {
    wordCount[w] = (wordCount[w] || 0) + 1;
  }

  for (const [word, count] of Object.entries(wordCount)) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash;
    }
    const idx = Math.abs(hash) % 384;
    vec[idx] += count * Math.log(1 + count);

    // bigram context
    const idx2 = (Math.abs(hash * 31)) % 384;
    vec[idx2] += count * 0.5;
  }

  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}

function sanitizeText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasMeaningfulText(text: string): boolean {
  const sample = text.slice(0, 4000);
  const readable = sample.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const replacementChars = sample.match(/�/g)?.length ?? 0;
  return readable >= 20 && replacementChars <= sample.length * 0.1;
}

// Smart chunking with paragraph awareness and metadata
function smartChunk(text: string): { content: string; lineStart: number; lineEnd: number }[] {
  const chunks: { content: string; lineStart: number; lineEnd: number }[] = [];
  const lines = text.split("\n");
  const paragraphs: { text: string; lineStart: number; lineEnd: number }[] = [];

  // Build paragraphs with line tracking
  let currentPara = "";
  let paraStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (currentPara.trim()) {
        paragraphs.push({ text: currentPara.trim(), lineStart: paraStart, lineEnd: i - 1 });
      }
      currentPara = "";
      paraStart = i + 1;
    } else {
      if (!currentPara) paraStart = i;
      currentPara += (currentPara ? " " : "") + line;
    }
  }
  if (currentPara.trim()) {
    paragraphs.push({ text: currentPara.trim(), lineStart: paraStart, lineEnd: lines.length - 1 });
  }

  // Merge paragraphs into 500-char chunks with 100-char overlap
  let current = "";
  let chunkLineStart = paragraphs[0]?.lineStart ?? 0;
  let chunkLineEnd = 0;

  for (const para of paragraphs) {
    if (current.length + para.text.length > 500 && current) {
      chunks.push({ content: current.trim(), lineStart: chunkLineStart, lineEnd: chunkLineEnd });
      // Keep last 100 chars as overlap
      const overlap = current.slice(-100);
      current = overlap + " " + para.text;
      chunkLineStart = Math.max(0, chunkLineEnd - 2);
      chunkLineEnd = para.lineEnd;
    } else {
      current = (current + " " + para.text).trim();
      chunkLineEnd = para.lineEnd;
    }
  }
  if (current.trim()) {
    chunks.push({ content: current.trim(), lineStart: chunkLineStart, lineEnd: chunkLineEnd });
  }

  return chunks.filter(c => c.content.length > 30);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentName, documentText, mimeType, fileSize } = await req.json();

    if (!documentName || !documentText) {
      return new Response(
        JSON.stringify({ error: "documentName and documentText are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanText = sanitizeText(documentText);

    if (!hasMeaningfulText(cleanText)) {
      return new Response(
        JSON.stringify({ error: "Could not extract readable text from this file. Please upload a text-based PDF/TXT/DOCX file." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Insert document metadata
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({
        name: documentName,
        size: fileSize || cleanText.length,
        mime_type: mimeType || "text/plain",
        status: "processing",
        chunk_count: 0,
      })
      .select("id")
      .single();

    if (docError) {
      console.error("Doc insert error:", docError);
      throw new Error(`Failed to create document record: ${docError.message}`);
    }

    const documentId = doc.id;

    // 2. Smart chunk with metadata
    const chunks = smartChunk(cleanText);
    console.log(`Document "${documentName}": ${chunks.length} chunks from ${cleanText.length} chars`);

    // 3. Generate TF-IDF embeddings and insert chunks in batches
    for (let i = 0; i < chunks.length; i += 20) {
      const batch = chunks.slice(i, i + 20).map((chunk, idx) => {
        const sanitizedChunk = sanitizeText(chunk.content);
        return {
          document_id: documentId,
          document_name: documentName,
          chunk_index: i + idx,
          content: sanitizedChunk,
          embedding: JSON.stringify(betterEmbed(sanitizedChunk)),
        };
      });

      const { error: chunkError } = await supabase
        .from("document_chunks")
        .insert(batch);

      if (chunkError) {
        console.error(`Chunk insert error (batch ${i}):`, JSON.stringify(chunkError));
        throw new Error(`Failed to insert chunks: ${chunkError.message}`);
      }
      console.log(`Inserted batch ${i}-${i + batch.length - 1}`);
    }

    // 4. Update document status
    await supabase
      .from("documents")
      .update({ status: "ready", chunk_count: chunks.length })
      .eq("id", documentId);

    console.log(`✅ Document "${documentName}" processed: ${chunks.length} chunks stored`);

    return new Response(
      JSON.stringify({
        success: true,
        documentId,
        chunkCount: chunks.length,
        documentName,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("process-document error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
