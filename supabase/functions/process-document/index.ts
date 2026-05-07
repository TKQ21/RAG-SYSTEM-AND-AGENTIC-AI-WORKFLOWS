import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function sanitizeText(text: string): string {
  return String(text || "")
    .replace(/\u0000/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;

async function embed(text: string, taskType = "RETRIEVAL_DOCUMENT"): Promise<number[]> {
  const trimmed = text.slice(0, 8000);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: trimmed }] },
        taskType,
          outputDimensionality: 768,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`embed failed ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const values: number[] = json.embedding?.values || [];
  if (values.length !== 768) throw new Error(`unexpected embedding dim ${values.length}`);
  return values;
}

function chunkText(text: string, chunkSize = 800, overlap = 150): string[] {
  const clean = sanitizeText(text);
  if (clean.length <= chunkSize) return [clean];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + chunkSize, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const lastBreak = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("\n"),
      );
      if (lastBreak > chunkSize * 0.5) end = i + lastBreak + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece.length > 10) chunks.push(piece);
    if (end >= clean.length) break;
    i = end - overlap;
  }
  return chunks;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { documentName, documentText, mimeType, fileSize } = await req.json();

    if (!documentName || typeof documentName !== "string") {
      return new Response(JSON.stringify({ error: "documentName required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fullText = sanitizeText(documentText || "");
    if (fullText.length < 20) {
      return new Response(JSON.stringify({ error: "No readable text extracted" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    if (docError) throw new Error(`document insert failed: ${docError.message}`);

    const chunks = chunkText(fullText);
    console.log(`"${documentName}": ${chunks.length} chunks`);

    // Process in parallel batches to scale to large documents (~10k pages)
    const CONCURRENCY = 8;
    const BATCH_INSERT = 50;
    let stored = 0;
    let cursor = 0;
    const positions = chunks.map((content) => {
      const startChar = fullText.indexOf(content.slice(0, 30), cursor);
      const realStart = startChar >= 0 ? startChar : cursor;
      cursor = realStart + content.length;
      return { content, realStart };
    });

    let pendingRows: any[] = [];
    const flush = async () => {
      if (!pendingRows.length) return;
      const { error } = await supabase.from("document_chunks").insert(pendingRows);
      if (error) console.error("batch insert failed", error.message);
      else stored += pendingRows.length;
      pendingRows = [];
    };

    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const slice = chunks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (content, j) => {
          try {
            const embedding = await embed(content, "RETRIEVAL_DOCUMENT");
            return { content, embedding, idx: i + j };
          } catch (e) {
            console.error("embed error chunk", i + j, e);
            return null;
          }
        }),
      );
      for (const r of results) {
        if (!r) continue;
        const pos = positions[r.idx];
        pendingRows.push({
          document_id: doc.id,
          document_name: documentName,
          chunk_index: r.idx,
          content: r.content,
          embedding: JSON.stringify(r.embedding),
          page_num: 1,
          start_char: pos.realStart,
          end_char: pos.realStart + r.content.length,
        });
        if (pendingRows.length >= BATCH_INSERT) await flush();
      }
    }
    await flush();

    await supabase.from("documents").update({ status: "ready", chunk_count: stored }).eq("id", doc.id);

    return new Response(JSON.stringify({ success: true, documentId: doc.id, chunkCount: stored, documentName }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("process-document:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
