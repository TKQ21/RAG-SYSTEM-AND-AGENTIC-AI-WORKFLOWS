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

function embed(text: string): number[] {
  const vec = new Array(384).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 384] += text.charCodeAt(i) / 1000;
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / mag);
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

    let stored = 0;
    let cursor = 0;
    for (let idx = 0; idx < chunks.length; idx++) {
      const content = chunks[idx];
      const startChar = fullText.indexOf(content.slice(0, 30), cursor);
      const realStart = startChar >= 0 ? startChar : cursor;
      cursor = realStart + content.length;
      const embedding = embed(content);
      const { error: chunkError } = await supabase.from("document_chunks").insert({
        document_id: doc.id,
        document_name: documentName,
        chunk_index: idx,
        content,
        embedding: JSON.stringify(embedding),
        page_num: 1,
        start_char: realStart,
        end_char: realStart + content.length,
      });
      if (chunkError) console.error("chunk insert failed", idx, chunkError.message);
      else stored += 1;
    }

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
