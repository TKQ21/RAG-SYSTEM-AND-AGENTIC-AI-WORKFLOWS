import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Gemini Embedding (768-dim) ──
async function getGeminiEmbedding(text: string, apiKey: string): Promise<number[]> {
  const truncated = text.slice(0, 2000);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text: truncated }] },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embedding failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.embedding.values;
}

// ── Gemini Vision for image-heavy PDFs ──
async function extractPageTextWithVision(
  pageBase64: string,
  pageNum: number,
  apiKey: string
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: pageBase64,
              },
            },
            {
              text: `Extract ALL information from this page completely.
Include every number, percentage, label, chart value, table row, KPI, title.
For charts: list every data point with its label and value.
For tables: preserve all rows and columns.
Format:
[Page ${pageNum}]
Label: Value
Miss nothing. Extract EVERYTHING.`,
            },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
    }
  );
  if (!res.ok) {
    console.error(`Vision failed page ${pageNum}: ${res.status}`);
    return "";
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
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

/** Data-aware chunking: 200 chars, force split on data boundaries */
function smartChunk(text: string): { content: string; pageNum: number }[] {
  const CHUNK_SIZE = 200;
  const chunks: { content: string; pageNum: number }[] = [];
  const lines = text.split("\n");
  let currentPage = 1;
  let buffer = "";
  let bufferPage = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const pageMatch = trimmed.match(/^\[?Page\s*(\d+)\]?/i);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1]);
      continue;
    }

    const isDataLine =
      /:/.test(trimmed) ||
      /\d+[\.\-–]\d+/.test(trimmed) ||
      /\d+\s*%/.test(trimmed) ||
      /\|/.test(trimmed) ||
      /^\s*[-•]\s/.test(trimmed);

    if (isDataLine && buffer.length > 50) {
      chunks.push({ content: buffer.trim(), pageNum: bufferPage });
      buffer = trimmed + " ";
      bufferPage = currentPage;
    } else if (buffer.length + trimmed.length > CHUNK_SIZE && buffer.length > 30) {
      chunks.push({ content: buffer.trim(), pageNum: bufferPage });
      buffer = trimmed + " ";
      bufferPage = currentPage;
    } else {
      if (!buffer) bufferPage = currentPage;
      buffer += (buffer ? " " : "") + trimmed;
    }
  }

  if (buffer.trim().length > 20) {
    chunks.push({ content: buffer.trim(), pageNum: bufferPage });
  }

  return chunks;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { documentName, documentText, mimeType, fileSize, pageImages } = await req.json();

    if (!documentName) {
      return new Response(JSON.stringify({ error: "documentName is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Choose API key: prefer GEMINI_API_KEY, fallback to LOVABLE_API_KEY for vision
    const geminiKey = GEMINI_API_KEY;
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let fullText = "";

    // Vision extraction for image-heavy PDFs using Gemini Vision directly
    if (pageImages && Array.isArray(pageImages) && pageImages.length > 0) {
      console.log(`🔍 Gemini Vision extraction on ${pageImages.length} pages...`);
      for (let i = 0; i < pageImages.length; i++) {
        try {
          const pageText = await extractPageTextWithVision(pageImages[i], i + 1, geminiKey);
          if (pageText) fullText += pageText + "\n\n";
          console.log(`✅ Vision page ${i + 1}: ${pageText.length} chars`);
        } catch (err) {
          console.error(`Vision error page ${i + 1}:`, err);
        }
      }
    }

    // Standard text
    if (documentText) {
      const cleanText = sanitizeText(documentText);
      if (hasMeaningfulText(cleanText)) fullText += cleanText;
    }

    fullText = sanitizeText(fullText);

    if (!fullText || fullText.length < 20) {
      return new Response(
        JSON.stringify({ error: "Could not extract any readable text." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert document record
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({ name: documentName, size: fileSize || fullText.length, mime_type: mimeType || "text/plain", status: "processing", chunk_count: 0 })
      .select("id")
      .single();

    if (docError) throw new Error(`Failed to create document: ${docError.message}`);
    const documentId = doc.id;

    // Smart chunk
    const chunks = smartChunk(fullText);
    console.log(`"${documentName}": ${chunks.length} chunks from ${fullText.length} chars`);

    // Embed with Gemini and insert in batches of 10 (rate limit friendly)
    for (let i = 0; i < chunks.length; i += 10) {
      const batch = chunks.slice(i, i + 10);
      const rows = [];

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const sanitized = sanitizeText(chunk.content);
        try {
          const embedding = await getGeminiEmbedding(sanitized, geminiKey);
          rows.push({
            document_id: documentId,
            document_name: documentName,
            chunk_index: i + j,
            content: sanitized,
            embedding: JSON.stringify(embedding),
          });
        } catch (embErr) {
          console.error(`Embedding failed chunk ${i + j}:`, embErr);
          // Still insert without embedding
          rows.push({
            document_id: documentId,
            document_name: documentName,
            chunk_index: i + j,
            content: sanitized,
            embedding: null,
          });
        }
      }

      const { error: chunkError } = await supabase.from("document_chunks").insert(rows);
      if (chunkError) throw new Error(`Chunk insert failed: ${chunkError.message}`);
      console.log(`Inserted batch ${i}-${i + rows.length - 1}`);
    }

    // Update document status
    await supabase.from("documents").update({ status: "ready", chunk_count: chunks.length }).eq("id", documentId);
    console.log(`✅ "${documentName}" done: ${chunks.length} chunks (Gemini embeddings)`);

    return new Response(
      JSON.stringify({ success: true, documentId, chunkCount: chunks.length, documentName, visionPages: pageImages?.length || 0 }),
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
