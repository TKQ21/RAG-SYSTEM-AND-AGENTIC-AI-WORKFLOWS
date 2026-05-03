import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function sanitizeText(t: string): string {
  return t.replace(/\u0000/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ")
    .replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Smart chunking: preserve data integrity, keep tables/headings together (~500 chars) */
function smartChunk(text: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  let buf = "";
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    const isData = l.includes(":") || /\d+\.?\d*%/.test(l) || /\d{2,}\s*[-–]\s*\d{2,}/.test(l)
      || l.includes("|") || /^\[Page/i.test(l);
    if (isData && buf.length > 100) {
      out.push(buf.trim());
      buf = l + "\n";
    } else if (buf.length + l.length > 500 && buf) {
      out.push(buf.trim());
      buf = l + "\n";
    } else {
      buf += l + "\n";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((c) => c.length > 20);
}

/** Gemini text-embedding-004 (768-dim, true semantic) */
async function geminiEmbed(text: string, apiKey: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT"): Promise<number[]> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text: text.slice(0, 2000) }] },
        taskType,
      }),
    }
  );
  const d = await r.json();
  if (d.error) throw new Error("Embed: " + (d.error.message || JSON.stringify(d.error)));
  return d.embedding.values;
}

/** Gemini Vision via Lovable AI Gateway for image-heavy PDFs */
async function visionExtract(pageImages: string[], lovableKey: string, docName: string): Promise<string> {
  const out: string[] = [];
  for (let i = 0; i < pageImages.length; i += 3) {
    const batch = pageImages.slice(i, i + 3);
    const pageNos = batch.map((_, idx) => i + idx + 1);
    const parts: any[] = batch.map((img) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } }));
    parts.push({
      type: "text",
      text: `Extract ALL content from these document pages (${pageNos.join(", ")} of "${docName}").
For EACH page extract: every word, every number/percentage/decimal, every table (header + all rows with values), every chart (title + all data points with labels), every KPI/metric/figure, every heading.
Format:
[Page N]
Section: content
Label: Value
Miss absolutely nothing. Be exhaustive.`,
    });
    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-pro", messages: [{ role: "user", content: parts }], max_tokens: 8000 }),
      });
      if (!r.ok) { console.error(`vision ${pageNos}: ${r.status}`); continue; }
      const d = await r.json();
      const txt = d.choices?.[0]?.message?.content || "";
      if (txt) out.push(txt);
    } catch (e) { console.error("vision err:", e); }
  }
  return out.join("\n\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const GEMINI = Deno.env.get("GEMINI_API_KEY");
    const LOVABLE = Deno.env.get("LOVABLE_API_KEY");
    if (!GEMINI) throw new Error("GEMINI_API_KEY missing");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { documentName, documentText, mimeType, fileSize, pageImages } = await req.json();
    if (!documentName) {
      return new Response(JSON.stringify({ error: "documentName required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let fullText = "";
    if (Array.isArray(pageImages) && pageImages.length > 0 && LOVABLE) {
      console.log(`Vision on ${pageImages.length} pages…`);
      fullText += await visionExtract(pageImages, LOVABLE, documentName) + "\n\n";
    }
    if (documentText) fullText += sanitizeText(documentText);
    fullText = sanitizeText(fullText);

    if (!fullText || fullText.length < 20) {
      return new Response(JSON.stringify({ error: "No readable text extracted" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: doc, error: dErr } = await supabase.from("documents")
      .insert({ name: documentName, size: fileSize || fullText.length, mime_type: mimeType || "text/plain", status: "processing", chunk_count: 0 })
      .select("id").single();
    if (dErr) throw new Error("doc insert: " + dErr.message);

    const chunks = smartChunk(fullText);
    console.log(`"${documentName}": ${chunks.length} chunks`);

    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i];
      let embedding: number[];
      try { embedding = await geminiEmbed(content, GEMINI, "RETRIEVAL_DOCUMENT"); }
      catch (e) { console.error("embed fail chunk", i, e); continue; }

      const { error: cErr } = await supabase.from("document_chunks").insert({
        document_id: doc.id, document_name: documentName, chunk_index: i,
        content, embedding: JSON.stringify(embedding),
      });
      if (cErr) console.error("chunk insert", i, cErr.message);
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 300));
    }

    await supabase.from("documents").update({ status: "ready", chunk_count: chunks.length }).eq("id", doc.id);
    return new Response(JSON.stringify({ success: true, documentId: doc.id, chunkCount: chunks.length, documentName }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("process-document:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
