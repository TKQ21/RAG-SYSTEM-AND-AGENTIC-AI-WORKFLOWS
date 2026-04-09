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

function smartChunk(text: string): { content: string; lineStart: number; lineEnd: number }[] {
  const chunks: { content: string; lineStart: number; lineEnd: number }[] = [];
  const lines = text.split("\n");
  const paragraphs: { text: string; lineStart: number; lineEnd: number }[] = [];

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

  let current = "";
  let chunkLineStart = paragraphs[0]?.lineStart ?? 0;
  let chunkLineEnd = 0;

  for (const para of paragraphs) {
    if (current.length + para.text.length > 500 && current) {
      chunks.push({ content: current.trim(), lineStart: chunkLineStart, lineEnd: chunkLineEnd });
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

/**
 * Use Lovable AI Gateway with Gemini Vision to extract text from PDF page images
 */
async function extractTextFromImages(
  pageImages: string[],
  apiKey: string,
  documentName: string
): Promise<string> {
  const extractedPages: string[] = [];

  // Process pages in batches of 3 to avoid token limits
  for (let i = 0; i < pageImages.length; i += 3) {
    const batch = pageImages.slice(i, i + 3);
    const pageNumbers = batch.map((_, idx) => i + idx + 1);

    const contentParts: any[] = [];
    for (let j = 0; j < batch.length; j++) {
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${batch[j]}`,
        },
      });
    }
    contentParts.push({
      type: "text",
      text: `Extract ALL text, data, numbers, tables, charts, KPIs, metrics, labels, and values from these document pages (pages ${pageNumbers.join(", ")} of "${documentName}").

For EACH page extract:
- All visible text exactly as written
- All numbers, percentages, and metrics
- All chart/graph values and labels
- All table rows and columns (preserve structure)
- All KPIs, dashboard metrics, and indicators
- All headings, titles, and captions

Format as:
[Page X]
(extracted content here)

Extract EVERYTHING. Miss nothing. Keep original formatting.`,
    });

    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "user",
              content: contentParts,
            },
          ],
          max_tokens: 8000,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Vision extraction failed for pages ${pageNumbers.join(",")}: ${response.status} ${errText}`);
        continue;
      }

      const data = await response.json();
      const extractedText = data.choices?.[0]?.message?.content || "";
      if (extractedText) {
        extractedPages.push(extractedText);
      }
      console.log(`✅ Vision extracted pages ${pageNumbers.join(",")}: ${extractedText.length} chars`);
    } catch (err) {
      console.error(`Vision extraction error for pages ${pageNumbers.join(",")}:`, err);
    }
  }

  return extractedPages.join("\n\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentName, documentText, mimeType, fileSize, pageImages } = await req.json();

    if (!documentName) {
      return new Response(
        JSON.stringify({ error: "documentName is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    let fullText = "";

    // Step 1: Use Vision AI to extract text from page images (if available)
    if (pageImages && Array.isArray(pageImages) && pageImages.length > 0 && LOVABLE_API_KEY) {
      console.log(`🔍 Running Vision extraction on ${pageImages.length} page images...`);
      const visionText = await extractTextFromImages(pageImages, LOVABLE_API_KEY, documentName);
      if (visionText) {
        fullText += visionText + "\n\n";
        console.log(`Vision extracted ${visionText.length} chars`);
      }
    }

    // Step 2: Also use the pdfjs-extracted text
    if (documentText) {
      const cleanPdfText = sanitizeText(documentText);
      if (hasMeaningfulText(cleanPdfText)) {
        fullText += cleanPdfText;
      }
    }

    fullText = sanitizeText(fullText);

    if (!fullText || fullText.length < 20) {
      return new Response(
        JSON.stringify({ error: "Could not extract any readable text. Please upload a text-based or image-based PDF/TXT/DOCX file." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Insert document metadata
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({
        name: documentName,
        size: fileSize || fullText.length,
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
    const chunks = smartChunk(fullText);
    console.log(`Document "${documentName}": ${chunks.length} chunks from ${fullText.length} chars`);

    // 3. Generate embeddings and insert chunks in batches
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

      const { error: chunkError } = await supabase.from("document_chunks").insert(batch);

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

    console.log(`✅ Document "${documentName}" processed: ${chunks.length} chunks stored (vision: ${pageImages?.length || 0} pages)`);

    return new Response(
      JSON.stringify({
        success: true,
        documentId,
        chunkCount: chunks.length,
        documentName,
        visionPages: pageImages?.length || 0,
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
