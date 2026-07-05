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

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gatewayFetch(path: string, body: unknown, attempts = 3): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(`${GATEWAY}${path}`, {
      method: "POST",
      headers: { "Lovable-API-Key": LOVABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) return res;
    last = res;
    await wait(900 * (attempt + 1));
  }
  return last!;
}

async function ocrPdfWithVision(pdfBase64: string, documentName: string, mimeType = "application/pdf"): Promise<string> {
  if (!pdfBase64) return "";
  const res = await gatewayFetch("/chat/completions", {
    model: "google/gemini-2.5-flash",
    temperature: 0,
    max_tokens: 12000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "OCR this full PDF. Extract ALL readable text exactly as it appears from every page. Preserve page order, question numbers, tables, rows, columns, names, roll numbers, dates, marks, options, and symbols. Prefix each page as [Page N]. Return only raw extracted text; no summary and no commentary.",
          },
          {
            type: "file",
            file: {
              filename: documentName || "document.pdf",
              file_data: `data:${mimeType || "application/pdf"};base64,${pdfBase64}`,
            },
          },
        ],
      },
    ],
  });
  if (!res.ok) {
    console.error("pdf vision ocr failed", res.status, (await res.text()).slice(0, 300));
    return "";
  }
  const json = await res.json();
  return String(json.choices?.[0]?.message?.content || "").trim();
}

async function ocrPageImagesTogether(images: string[]): Promise<string> {
  if (!images.length) return "";
  const content: any[] = [
    {
      type: "text",
      text:
        "Extract ALL readable text from these document page images exactly as it appears. Preserve page order, line breaks, tables, numbers, question numbers, booklet numbers, names and labels. Ignore decorative watermarks/noise. Return only raw extracted text. Prefix each page as: [Page N]",
    },
  ];
  images.forEach((base64Jpeg) => {
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Jpeg}` } });
  });

  const res = await gatewayFetch("/chat/completions", {
    model: "google/gemini-2.5-flash",
    temperature: 0,
    messages: [{ role: "user", content }],
  });
  if (!res.ok) {
    console.error("vision ocr failed", res.status, (await res.text()).slice(0, 200));
    return "";
  }
  const json = await res.json();
  return String(json.choices?.[0]?.message?.content || "").trim();
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const inputs = texts.map((text) => text.slice(0, 8000));
  const res = await gatewayFetch("/embeddings", {
    model: "openai/text-embedding-3-small",
    input: inputs,
    dimensions: 768,
  });
  if (!res.ok) {
    throw new Error(`embed failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json();
  const ordered = [...(json.data || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = ordered.map((item) => item.embedding as number[]);
  if (vectors.length !== texts.length) throw new Error(`embedding batch mismatch ${vectors.length}/${texts.length}`);
  for (const values of vectors) {
    if (values.length !== 768) throw new Error(`unexpected embedding dim ${values.length}`);
  }
  return vectors;
}

async function ocrPageImage(base64Jpeg: string): Promise<string> {
  const res = await gatewayFetch("/chat/completions", {
    model: "google/gemini-2.5-flash",
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Extract ALL text from this document page exactly as it appears, preserving line breaks, tables, numbers and order. Return only the raw extracted text with no commentary." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Jpeg}` } },
        ],
      },
    ],
  });
  if (!res.ok) {
    console.error("vision ocr failed", res.status, (await res.text()).slice(0, 200));
    return "";
  }
  const json = await res.json();
  return String(json.choices?.[0]?.message?.content || "").trim();
}

async function ocrPagesInParallel(images: string[], concurrency = 3): Promise<string> {
  const combined = await ocrPageImagesTogether(images);
  if (combined.length > 20) return combined;

  const out: string[] = new Array(images.length).fill("");
  for (let i = 0; i < images.length; i += concurrency) {
    const slice = images.slice(i, i + concurrency);
    const results = await Promise.all(slice.map((img) => ocrPageImage(img).catch(() => "")));
    results.forEach((t, j) => { out[i + j] = t; });
  }
  return out.filter(Boolean).join("\n\n");
}

function chunkText(text: string, chunkSize = 950, overlap = 180): string[] {
  const clean = sanitizeText(text);
  const spreadsheetChunks = chunkSpreadsheetRows(clean);
  if (spreadsheetChunks.length) return spreadsheetChunks;
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

function chunkSpreadsheetRows(clean: string): string[] {
  if (!/(^|\n)## Rows \(structured\)(\n|$)/i.test(clean) || !/(^|\n)Row\s+\d+\s*:/i.test(clean)) return [];

  const chunks: string[] = [];
  let meta: string[] = [];
  let rows: string[] = [];
  let rowChars = 0;

  const flush = () => {
    if (!rows.length) return;
    const piece = [...meta.slice(-6), ...rows].join("\n").trim();
    if (piece.length > 10) chunks.push(piece);
    rows = [];
    rowChars = 0;
  };

  for (const rawLine of clean.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^# Sheet:/i.test(line)) {
      flush();
      meta = [line];
      continue;
    }

    if (/^(Total rows:|Total columns:|Columns:|Large sheet:|## Rows \(structured\))/i.test(line)) {
      meta.push(line);
      continue;
    }

    if (/^Row\s+\d+\s*:/i.test(line)) {
      if (rows.length > 0 && rowChars + line.length > 1400) flush();
      rows.push(line);
      rowChars += line.length + 1;
      continue;
    }

    if (!line.startsWith("|") && meta.length < 6) meta.push(line);
  }
  flush();

  return chunks;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { documentName, documentText, mimeType, fileSize, pageImages, pdfBase64, pageCount } = await req.json();

    if (!documentName || typeof documentName !== "string") {
      return new Response(JSON.stringify({ error: "documentName required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let fullText = sanitizeText(documentText || "");
    const images: string[] = Array.isArray(pageImages) ? pageImages : [];
    const rawPdf = typeof pdfBase64 === "string" ? pdfBase64 : "";

    // Decide if we need OCR: scanned/visual PDFs need Vision, while text PDFs can use native text.
    const letterCount = (fullText.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
    const pageTotal = Number(pageCount) > 0 ? Number(pageCount) : Math.max(images.length, 1);
    const avgPerPage = fullText.length / pageTotal;
    const needsOcr = (rawPdf || images.length > 0) && (fullText.length < 500 || letterCount < 100 || avgPerPage < 120);

    if (needsOcr) {
      console.log(`OCR fallback: native text ${fullText.length} chars across ${pageTotal} pages — running Gemini Vision`);
      const ocrText = rawPdf
        ? await ocrPdfWithVision(rawPdf, documentName, mimeType || "application/pdf")
        : await ocrPagesInParallel(images, 2);
      if (ocrText.length > fullText.length) {
        fullText = sanitizeText(ocrText);
      }
      if (fullText.length < 20 && images.length > 0) {
        const imageOcrText = await ocrPagesInParallel(images, 2);
        if (imageOcrText.length > fullText.length) fullText = sanitizeText(imageOcrText);
      }
    }

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
        user_id: userId,
      })
      .select("id")
      .single();

    if (docError) throw new Error(`document insert failed: ${docError.message}`);

    const chunks = chunkText(fullText);
    console.log(`"${documentName}": ${chunks.length} chunks`);

    // Batch embeddings into one gateway request per group to avoid rate limits and scale to large documents.
    const EMBED_BATCH = 64;
    const BATCH_INSERT = 100;
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

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const slice = chunks.slice(i, i + EMBED_BATCH);
      let vectors: number[][] = [];
      try {
        vectors = await embedBatch(slice);
      } catch (e) {
        console.error("embed batch error", i, e);
        continue;
      }
      for (let j = 0; j < slice.length; j += 1) {
        const idx = i + j;
        const pos = positions[idx];
        pendingRows.push({
          document_id: doc.id,
          document_name: documentName,
          chunk_index: idx,
          content: slice[j],
          embedding: JSON.stringify(vectors[j]),
          page_num: 1,
          start_char: pos.realStart,
          end_char: pos.realStart + slice[j].length,
          user_id: userId,
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
