import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Normalize ranges for better embedding: "41-50" → "41 to 50 age group" */
function normalizeRanges(text: string): string {
  return text.replace(/(\d+)\s*[-–—]\s*(\d+)/g, "$1 to $2 age group");
}

/** TF-IDF style 384-dim embedding with range normalization + bigrams */
function betterEmbed(text: string): number[] {
  const vec = new Array(384).fill(0);
  const normalized = normalizeRanges(text.toLowerCase());
  const words = normalized
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const wordCount: Record<string, number> = {};
  for (const w of words) wordCount[w] = (wordCount[w] || 0) + 1;

  // Unigrams
  for (const [word, count] of Object.entries(wordCount)) {
    let h = 0;
    for (let i = 0; i < word.length; i++) {
      h = ((h << 5) - h) + word.charCodeAt(i);
      h = h & h;
    }
    vec[Math.abs(h) % 384] += count * Math.log(1 + count);
    vec[(Math.abs(h * 31)) % 384] += count * 0.5;
  }

  // Bigrams for context
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = words[i] + "_" + words[i + 1];
    let h = 0;
    for (let j = 0; j < bigram.length; j++) {
      h = ((h << 5) - h) + bigram.charCodeAt(j);
      h = h & h;
    }
    vec[Math.abs(h) % 384] += 0.3;
  }

  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / mag);
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

/** Structure-aware chunking: keep tables intact, attach heading to following block.
 *  Tables are detected by consecutive `|`-separated lines and emitted as a single chunk
 *  (with the most recent heading prepended). Paragraphs are bundled up to ~900 chars. */
function smartChunk(text: string): { content: string; lineStart: number; lineEnd: number; pageNum: number }[] {
  const PARA_TARGET = 900;
  const chunks: { content: string; lineStart: number; lineEnd: number; pageNum: number }[] = [];
  const lines = text.split("\n");
  let currentPage = 1;
  let lastHeading = "";

  const isTableLine = (s: string) => {
    const t = s.trim();
    return t.length > 0 && (t.match(/\|/g)?.length ?? 0) >= 2;
  };
  const isHeadingLine = (s: string) => {
    const t = s.trim();
    if (!t || t.length > 120) return false;
    if (/^#{1,6}\s+/.test(t)) return true; // markdown
    if (/^\[Page\s*\d+\]/i.test(t)) return false;
    // ALL CAPS or Title Case short line, no period, no pipe
    if (/[|:]/.test(t)) return false;
    const isAllCaps = t === t.toUpperCase() && /[A-Z]/.test(t) && t.length <= 80;
    const isTitleCase = /^[A-Z][\w\s\-&,]{2,80}$/.test(t) && !/\.$/.test(t);
    return isAllCaps || isTitleCase;
  };

  let buffer: string[] = [];
  let bufferStart = 0;
  let bufferPage = 1;
  let bufferLen = 0;

  const flushBuffer = (endLine: number) => {
    if (!buffer.length) return;
    const content = buffer.join(" ").trim();
    if (content.length >= 20) {
      chunks.push({ content, lineStart: bufferStart, lineEnd: endLine, pageNum: bufferPage });
    }
    buffer = [];
    bufferLen = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { continue; }

    const pageMatch = line.match(/^\[?Page\s*(\d+)\]?$/i);
    if (pageMatch) {
      flushBuffer(i - 1);
      currentPage = parseInt(pageMatch[1]);
      continue;
    }

    // Detect a table: collect contiguous table lines into one chunk with heading prefix
    if (isTableLine(line)) {
      flushBuffer(i - 1);
      const tableStart = i;
      const tableLines: string[] = [];
      while (i < lines.length && (isTableLine(lines[i]) || /^[\s\-=+|]+$/.test(lines[i].trim()))) {
        if (lines[i].trim()) tableLines.push(lines[i].trim());
        i++;
      }
      i--; // step back, outer loop will increment
      const headingPrefix = lastHeading ? `${lastHeading}\n` : "";
      const tableContent = `${headingPrefix}[TABLE]\n${tableLines.join("\n")}\n[/TABLE]`;
      chunks.push({ content: tableContent, lineStart: tableStart, lineEnd: i, pageNum: currentPage });
      continue;
    }

    if (isHeadingLine(line)) {
      flushBuffer(i - 1);
      lastHeading = line.replace(/^#{1,6}\s+/, "");
      // start a fresh paragraph buffer with the heading included
      buffer = [lastHeading];
      bufferStart = i;
      bufferPage = currentPage;
      bufferLen = lastHeading.length;
      continue;
    }

    if (!buffer.length) {
      bufferStart = i;
      bufferPage = currentPage;
    }
    buffer.push(line);
    bufferLen += line.length + 1;

    if (bufferLen >= PARA_TARGET) {
      flushBuffer(i);
    }
  }

  flushBuffer(lines.length - 1);
  return chunks;
}

/** Use Lovable AI Gateway with Gemini Vision for image-heavy PDFs */
async function extractTextFromImages(
  pageImages: string[],
  apiKey: string,
  documentName: string
): Promise<string> {
  const extractedPages: string[] = [];

  for (let i = 0; i < pageImages.length; i += 3) {
    const batch = pageImages.slice(i, i + 3);
    const pageNumbers = batch.map((_, idx) => i + idx + 1);

    const contentParts: any[] = [];
    for (const img of batch) {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${img}` },
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

Format as:
[Page X]
(extracted content here)

Extract EVERYTHING. Miss nothing.`,
    });

    try {
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "user", content: contentParts }],
          max_tokens: 8000,
        }),
      });

      if (!response.ok) {
        console.error(`Vision failed pages ${pageNumbers.join(",")}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const extracted = data.choices?.[0]?.message?.content || "";
      if (extracted) extractedPages.push(extracted);
      console.log(`✅ Vision pages ${pageNumbers.join(",")}: ${extracted.length} chars`);
    } catch (err) {
      console.error(`Vision error pages ${pageNumbers.join(",")}:`, err);
    }
  }

  return extractedPages.join("\n\n");
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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);

    let fullText = "";

    // Vision AI extraction for image-heavy PDFs
    if (pageImages && Array.isArray(pageImages) && pageImages.length > 0 && LOVABLE_API_KEY) {
      console.log(`🔍 Vision extraction on ${pageImages.length} pages...`);
      const visionText = await extractTextFromImages(pageImages, LOVABLE_API_KEY, documentName);
      if (visionText) fullText += visionText + "\n\n";
    }

    // Standard text extraction
    if (documentText) {
      const cleanPdfText = sanitizeText(documentText);
      if (hasMeaningfulText(cleanPdfText)) fullText += cleanPdfText;
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

    // Smart chunk with data-aware boundaries
    const chunks = smartChunk(fullText);
    console.log(`"${documentName}": ${chunks.length} chunks from ${fullText.length} chars`);

    // Embed and insert in batches (prefix content with [Page N] so citations can include page)
    for (let i = 0; i < chunks.length; i += 20) {
      const batch = chunks.slice(i, i + 20).map((chunk, idx) => {
        const sanitized = sanitizeText(chunk.content);
        const withPage = `[Page ${chunk.pageNum}] ${sanitized}`;
        return {
          document_id: documentId,
          document_name: documentName,
          chunk_index: i + idx,
          content: withPage,
          embedding: JSON.stringify(betterEmbed(withPage)),
        };
      });

      const { error: chunkError } = await supabase.from("document_chunks").insert(batch);
      if (chunkError) throw new Error(`Chunk insert failed: ${chunkError.message}`);
      console.log(`Inserted batch ${i}-${i + batch.length - 1}`);
    }

    // Update document status
    await supabase.from("documents").update({ status: "ready", chunk_count: chunks.length }).eq("id", documentId);
    console.log(`✅ "${documentName}" done: ${chunks.length} chunks (vision: ${pageImages?.length || 0} pages)`);

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
