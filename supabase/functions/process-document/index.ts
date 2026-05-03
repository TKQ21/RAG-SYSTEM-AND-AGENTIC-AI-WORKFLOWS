import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ChunkRecord = {
  content: string;
  chunkIndex: number;
  pageNum: number;
  startChar: number;
  endChar: number;
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

function normalizeForEmbedding(text: string): string {
  return sanitizeText(text)
    .toLowerCase()
    .replace(/(\d+)\s*[-–—]\s*(\d+)/g, "$1 to $2 age group")
    .replace(/\b(ka|ki|ke|mai|mein|me|kya|hai|toh|aur|se|ko|kitni|kitna)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashWord(word: string): number {
  let h = 0;
  for (let i = 0; i < word.length; i += 1) {
    h = ((h << 5) - h) + word.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function betterEmbed(text: string): number[] {
  const dim = 384;
  const vec = new Array(dim).fill(0);
  const normalized = normalizeForEmbedding(text);
  const words = normalized.split(/\s+/).filter((w) => w.length > 2);
  const wc: Record<string, number> = {};

  for (const word of words) wc[word] = (wc[word] || 0) + 1;

  for (let i = 0; i < words.length - 1; i += 1) {
    const bigram = `${words[i]}_${words[i + 1]}`;
    wc[bigram] = (wc[bigram] || 0) + 0.7;
  }

  for (const [word, count] of Object.entries(wc)) {
    const h = hashWord(word);
    vec[h % dim] += count * Math.log(1 + count);
    vec[(h * 31) % dim] += count * 0.5;
    vec[(h * 131) % dim] += count * 0.25;
  }

  const mag = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map((value) => value / mag);
}

function isDataBoundary(line: string): boolean {
  return (
    line.includes(":") ||
    line.includes("|") ||
    /\d+(?:\.\d+)?\s*%/.test(line) ||
    /\d+\s*[-–—]\s*\d+/.test(line) ||
    /\b\d+(?:\.\d+)?\b/.test(line)
  );
}

function splitLongChunk(text: string, maxSize = 200): string[] {
  if (text.length <= maxSize) return [text];
  const sentences = text.split(/(?<=[.!?।])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let buffer = "";

  for (const sentence of sentences.length ? sentences : text.match(/.{1,200}(?:\s|$)/g) || [text]) {
    const part = sentence.trim();
    if (!part) continue;
    if (buffer && buffer.length + part.length + 1 > maxSize) {
      chunks.push(buffer.trim());
      buffer = part;
    } else {
      buffer += buffer ? ` ${part}` : part;
    }
  }

  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks.flatMap((chunk) => chunk.length <= maxSize + 40 ? [chunk] : chunk.match(/.{1,200}(?:\s|$)/g)?.map((c) => c.trim()).filter(Boolean) || [chunk]);
}

function detectPage(line: string, currentPage: number): number {
  const match = line.match(/^\[?\s*page\s+(\d+)\s*\]?/i);
  return match ? Number(match[1]) : currentPage;
}

function smartChunk(text: string): ChunkRecord[] {
  const clean = sanitizeText(text);
  const lines = clean.split("\n");
  const chunks: ChunkRecord[] = [];
  let buffer = "";
  let pageNum = 1;
  let bufferPage = 1;
  let chunkIndex = 0;
  let globalCursor = 0;
  let bufferStart = 0;

  const flush = () => {
    const trimmed = buffer.trim();
    if (!trimmed) {
      buffer = "";
      return;
    }

    for (const piece of splitLongChunk(trimmed, 200)) {
      const localStart = clean.indexOf(piece.slice(0, Math.min(piece.length, 30)), Math.max(0, bufferStart - 20));
      const startChar = localStart >= 0 ? localStart : bufferStart;
      chunks.push({
        content: piece,
        chunkIndex,
        pageNum: bufferPage,
        startChar,
        endChar: startChar + piece.length,
      });
      chunkIndex += 1;
    }

    buffer = "";
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const rawPos = clean.indexOf(rawLine, globalCursor);
    if (rawPos >= 0) globalCursor = rawPos + rawLine.length;
    if (!line) continue;

    pageNum = detectPage(line, pageNum);
    if (/^\[?\s*page\s+\d+\s*\]?$/i.test(line)) continue;

    const startsNewDataPoint = isDataBoundary(line);
    if (startsNewDataPoint && buffer.trim()) flush();
    if (!buffer) {
      bufferStart = rawPos >= 0 ? rawPos : globalCursor;
      bufferPage = pageNum;
    }

    if (buffer.length + line.length + 1 > 200 && buffer.trim()) flush();
    if (!buffer) {
      bufferStart = rawPos >= 0 ? rawPos : globalCursor;
      bufferPage = pageNum;
    }
    buffer += `${line}\n`;
  }

  flush();
  return chunks.filter((chunk) => chunk.content.length > 8);
}

async function visionExtract(pageImages: string[], lovableKey: string, docName: string): Promise<string> {
  const extracted: string[] = [];

  for (let i = 0; i < pageImages.length; i += 2) {
    const batch = pageImages.slice(i, i + 2);
    const pageNos = batch.map((_, idx) => i + idx + 1);
    const content: any[] = batch.map((img) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } }));
    content.push({
      type: "text",
      text: `Extract ALL visible document data from pages ${pageNos.join(", ")} of "${docName}".\nFor each page, start with [Page N]. Preserve tables row-by-row. Extract every heading, label, name, number, percentage, range, KPI, chart value, and table cell exactly. Do not summarize.`,
    });

    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [{ role: "user", content }],
          temperature: 0,
          max_tokens: 6000,
        }),
      });

      if (!response.ok) {
        console.error(`vision extraction failed pages ${pageNos.join(",")}:`, response.status, await response.text());
        continue;
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || "";
      if (text.trim()) extracted.push(text.trim());
    } catch (error) {
      console.error("vision extraction error:", error);
    }
  }

  return extracted.join("\n\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE) throw new Error("LOVABLE_API_KEY missing");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { documentName, documentText, mimeType, fileSize, pageImages } = await req.json();

    if (!documentName || typeof documentName !== "string") {
      return new Response(JSON.stringify({ error: "documentName required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let fullText = "";
    if (Array.isArray(pageImages) && pageImages.length > 0) {
      console.log(`Vision extraction for ${Math.min(pageImages.length, 30)} pages`);
      fullText += `${await visionExtract(pageImages.slice(0, 30), LOVABLE, documentName)}\n\n`;
    }
    if (documentText) fullText += sanitizeText(documentText);
    fullText = sanitizeText(fullText);

    if (fullText.length < 20) {
      return new Response(JSON.stringify({ error: "No readable text extracted" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({ name: documentName, size: fileSize || fullText.length, mime_type: mimeType || "text/plain", status: "processing", chunk_count: 0 })
      .select("id")
      .single();

    if (docError) throw new Error(`document insert failed: ${docError.message}`);

    const chunks = smartChunk(fullText);
    console.log(`"${documentName}": ${chunks.length} chunks created with 200-char data boundaries`);

    let stored = 0;
    for (const chunk of chunks) {
      const embedding = betterEmbed(chunk.content);
      const { error: chunkError } = await supabase.from("document_chunks").insert({
        document_id: doc.id,
        document_name: documentName,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        embedding: JSON.stringify(embedding),
        page_num: chunk.pageNum,
        start_char: chunk.startChar,
        end_char: chunk.endChar,
      });

      if (chunkError) {
        console.error("chunk insert failed", chunk.chunkIndex, chunkError.message);
      } else {
        stored += 1;
      }
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
