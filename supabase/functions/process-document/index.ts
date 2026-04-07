import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Simple deterministic embedding - must match agent-chat exactly
function simpleEmbed(text: string): number[] {
  const vec = new Array(384).fill(0);
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    vec[i % 384] += lower.charCodeAt(i) / 1000;
  }
  for (let i = 0; i < lower.length - 1; i++) {
    const bigram = lower.charCodeAt(i) * 31 + lower.charCodeAt(i + 1);
    vec[(bigram) % 384] += 0.5 / 1000;
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}

// Sanitize text: remove null bytes and other problematic characters
function sanitizeText(text: string): string {
  return text
    .replace(/\u0000/g, "")        // Remove null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ") // Replace control chars with space
    .replace(/\s+/g, " ")          // Normalize whitespace
    .trim();
}

// Chunk text into overlapping segments
function chunkText(text: string, chunkSize = 800, overlap = 200): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      const words = current.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      current = overlapWords.join(" ") + " " + sentence;
    } else {
      current += (current ? " " : "") + sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Fallback: chunk by character count
  if (chunks.length === 0 && text.trim().length > 0) {
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
      chunks.push(text.slice(i, i + chunkSize).trim());
    }
  }

  return chunks.filter(c => c.length > 20);
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

    // Sanitize the entire text first to remove null bytes
    const cleanText = sanitizeText(documentText);

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

    // 2. Chunk the sanitized text
    const chunks = chunkText(cleanText);
    console.log(`Document "${documentName}": ${chunks.length} chunks from ${cleanText.length} chars`);

    // 3. Generate embeddings and insert chunks in batches
    for (let i = 0; i < chunks.length; i += 20) {
      const batch = chunks.slice(i, i + 20).map((content, idx) => ({
        document_id: documentId,
        document_name: documentName,
        chunk_index: i + idx,
        content: sanitizeText(content), // double-sanitize each chunk
        embedding: JSON.stringify(simpleEmbed(content)),
      }));

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
