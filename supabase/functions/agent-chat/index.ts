import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Embedding (must match process-document) ──
function normalizeRanges(text: string): string {
  return text.replace(/(\d+)\s*[-–—]\s*(\d+)/g, "$1 to $2 age group");
}

function betterEmbed(text: string): number[] {
  const vec = new Array(384).fill(0);
  const normalized = normalizeRanges(text.toLowerCase());
  const words = normalized.replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const wordCount: Record<string, number> = {};
  for (const w of words) wordCount[w] = (wordCount[w] || 0) + 1;
  for (const [word, count] of Object.entries(wordCount)) {
    let h = 0;
    for (let i = 0; i < word.length; i++) { h = ((h << 5) - h) + word.charCodeAt(i); h = h & h; }
    vec[Math.abs(h) % 384] += count * Math.log(1 + count);
    vec[(Math.abs(h * 31)) % 384] += count * 0.5;
  }
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = words[i] + "_" + words[i + 1];
    let h = 0;
    for (let j = 0; j < bigram.length; j++) { h = ((h << 5) - h) + bigram.charCodeAt(j); h = h & h; }
    vec[Math.abs(h) % 384] += 0.3;
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / mag);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

const STOP_WORDS = new Set([
  "a","an","the","is","are","was","were","what","which","who","when","where","tell","me",
  "about","for","from","with","this","that","these","those","and","or","to","of","in","on",
  "my","your","please","show","give","need","do","does","did","ka","ki","ke","mai","mein",
  "kitni","kitna","kya","hai","toh","aur","se","ko","ne","par","pe","ho","hain","tha","thi",
  "the","bhi","nahi","nhi","karo","batao","bata","dikhao",
]);

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function tokenize(text: string): string[] {
  return normalizeForSearch(text).split(" ").filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function getKeywordScore(chunkText: string, normalizedQuery: string, queryTerms: string[]): number {
  const normalizedChunk = normalizeForSearch(chunkText);
  const chunkTokens = new Set(tokenize(normalizedChunk));
  let score = normalizedChunk.includes(normalizedQuery) ? 1.5 : 0;
  for (const term of queryTerms) {
    if (!term) continue;
    if (term.includes(" ")) { if (normalizedChunk.includes(term)) score += 1.25; continue; }
    if (chunkTokens.has(term)) score += 1;
    else if (normalizedChunk.includes(term)) score += 0.5;
  }
  return Math.min(1, score / Math.max(3, queryTerms.length * 0.8));
}

function getReadabilityScore(text: string): number {
  const sample = text.slice(0, 1000);
  const readable = sample.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return readable / Math.max(sample.length, 1);
}

function isTableChunk(text: string): boolean {
  const pipeLines = (text.match(/\|/g) ?? []).length;
  const hasMultiplePipes = pipeLines >= 3;
  const hasGridStructure = /\n.*\|.*\n.*\|/.test(text);
  return hasMultiplePipes || hasGridStructure || /\[TABLE\]/i.test(text);
}

// ── Semantic intent extraction via Lovable AI ──
interface QueryIntent {
  keywords: string[];
  rewordedQueries: string[];
  wantsTable: boolean;
  language: "en" | "hi" | "mixed";
}

async function analyzeQueryIntent(query: string, apiKey: string): Promise<QueryIntent> {
  const fallback: QueryIntent = {
    keywords: tokenize(query),
    rewordedQueries: [query],
    wantsTable: /subject|paper|marks|score|syllabus|topic|table|row|column|exam|schedule/i.test(query),
    language: /[\u0900-\u097F]/.test(query) ? "hi" : "en",
  };

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You analyze user document Q&A queries (English/Hindi/Hinglish). Output ONLY a JSON object:
{"keywords":[3-8 most relevant search keywords in English],"rewordedQueries":[2-3 paraphrases in English emphasizing different angles],"wantsTable":boolean (true if asking about subjects/papers/marks/syllabus/topic/exam-row data or any tabular info),"language":"en"|"hi"|"mixed"}
No prose, no markdown, just JSON.`,
          },
          { role: "user", content: query },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      keywords: Array.isArray(parsed.keywords) && parsed.keywords.length ? parsed.keywords.map(String) : fallback.keywords,
      rewordedQueries: Array.isArray(parsed.rewordedQueries) && parsed.rewordedQueries.length ? parsed.rewordedQueries.map(String) : [query],
      wantsTable: Boolean(parsed.wantsTable) || fallback.wantsTable,
      language: parsed.language === "hi" || parsed.language === "mixed" ? parsed.language : fallback.language,
    };
  } catch (e) {
    console.error("Intent analysis failed:", e);
    return fallback;
  }
}

const SYSTEM_PROMPTS: Record<string, string> = {
  documents: `You are a precise document Q&A assistant (NotebookLM-style).

CRITICAL RULES — Follow exactly:
1. Answer ONLY from the [Context] chunks provided below.
2. NEVER use outside knowledge. NEVER guess. NEVER estimate.
3. If a chunk contains a TABLE (rows separated by | or grid structure), READ EVERY ROW carefully before deciding.
4. For questions about subjects, papers, marks, syllabus, topics, exam schedules — scan tables row-by-row and list ALL matching entries.
5. If user asks about a SPECIFIC range like "41-50", answer ONLY with 41-50 data. NEVER substitute.
6. If document has multiple values for same category, list ALL of them.
7. ONLY say "Not in document." after carefully reading every table row and confirming the data is truly absent.
8. Keep answers focused — 2-5 sentences (or a tight list for tabular data).
9. Temperature 0 — be deterministic.

CITATION FORMAT (mandatory):
After your answer, always write:
📌 Source: [filename] | Chunk #[number] | Page [number]
(Page number is the [Page N] prefix of the chunk.)
If multiple sources: list each on a new line.`,

  datascience: `You are a senior Data Science & ML Engineering assistant. Provide complete, runnable code with explanations.`,
  research: `You are an autonomous research agent. Break down questions into sub-tasks, provide structured reports.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, mode, sessionId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.documents;
    const userQuery = messages[messages.length - 1]?.content || "";

    if (sessionId && userQuery) {
      await supabase.from("chat_history").insert({ session_id: sessionId, role: "user", message: userQuery });
    }

    const aiMessages: Array<{ role: string; content: string }> = [{ role: "system", content: systemPrompt }];

    if (mode === "documents" && userQuery) {
      // 1. Semantic intent analysis
      const intent = await analyzeQueryIntent(userQuery, LOVABLE_API_KEY);
      console.log(`Intent: keywords=${intent.keywords.join(",")} | wantsTable=${intent.wantsTable} | lang=${intent.language}`);

      // 2. Build query variants from intent
      const variants = Array.from(new Set([
        userQuery,
        ...intent.rewordedQueries,
        intent.keywords.join(" "),
        normalizeRanges(userQuery),
      ])).filter(Boolean);

      const normalizedQuery = normalizeForSearch(userQuery);
      const allQueryTerms = Array.from(new Set([
        ...tokenize(userQuery),
        ...intent.keywords.map((k) => k.toLowerCase()),
      ]));

      const { data: allChunks, error: chunkError } = await supabase
        .from("document_chunks")
        .select("id, document_name, chunk_index, content, embedding")
        .limit(2000);

      if (chunkError) console.error("Chunk fetch error:", JSON.stringify(chunkError));

      let rankedChunks: any[] = [];
      if (allChunks && allChunks.length > 0) {
        const readableChunks = allChunks.filter((c: any) => getReadabilityScore(c.content ?? "") > 0.2);
        const chunkScores = new Map<number, any>();

        for (const variant of variants) {
          const variantEmbedding = betterEmbed(variant);
          const variantNorm = normalizeForSearch(variant);
          const variantTerms = Array.from(new Set([...tokenize(variant), ...allQueryTerms]));

          for (let ci = 0; ci < readableChunks.length; ci++) {
            const c = readableChunks[ci];
            let sim = 0;
            if (c.embedding) {
              let emb: number[];
              try {
                const raw = typeof c.embedding === "string" ? c.embedding : String(c.embedding);
                emb = JSON.parse(raw);
              } catch { emb = []; }
              if (emb.length === variantEmbedding.length) sim = cosineSimilarity(emb, variantEmbedding);
            }
            const kw = getKeywordScore(c.content, variantNorm, variantTerms);
            let hybrid = sim * 0.55 + kw * 0.45;

            // Table boost when intent suggests tabular data
            if (intent.wantsTable && isTableChunk(c.content)) {
              hybrid += 0.10;
            }

            const existing = chunkScores.get(ci);
            if (!existing || hybrid > existing.hybridScore) {
              chunkScores.set(ci, {
                document_name: c.document_name,
                chunk_index: c.chunk_index,
                content: c.content,
                similarity: sim,
                keywordScore: kw,
                hybridScore: hybrid,
                isTable: isTableChunk(c.content),
              });
            }
          }
        }

        rankedChunks = Array.from(chunkScores.values())
          .filter((c) => c.hybridScore > 0.05)
          .sort((a, b) => b.hybridScore - a.hybridScore)
          .slice(0, 18);

        if (rankedChunks.length === 0) {
          rankedChunks = readableChunks
            .map((c: any) => {
              const kw = getKeywordScore(c.content, normalizedQuery, allQueryTerms);
              return { document_name: c.document_name, chunk_index: c.chunk_index, content: c.content, similarity: 0, keywordScore: kw, hybridScore: kw, isTable: isTableChunk(c.content) };
            })
            .filter((c: any) => c.keywordScore > 0)
            .sort((a: any, b: any) => b.keywordScore - a.keywordScore)
            .slice(0, 18);
        }

        console.log(`Ranked ${readableChunks.length}/${allChunks.length} readable, top ${rankedChunks.length}, best=${rankedChunks[0]?.hybridScore?.toFixed(4) ?? "0"}, tables=${rankedChunks.filter((c) => c.isTable).length}`);
      }

      if (rankedChunks.length > 0) {
        // Build context capped at 18000 chars
        const MAX_CONTEXT = 18000;
        let total = 0;
        const parts: string[] = [];
        for (const c of rankedChunks) {
          const tag = c.isTable ? " | TABLE" : "";
          const block = `[Chunk #${c.chunk_index} | File: ${c.document_name} | Relevance: ${(c.hybridScore * 100).toFixed(1)}%${tag}]\n${c.content}`;
          if (total + block.length > MAX_CONTEXT) break;
          parts.push(block);
          total += block.length + 6;
        }
        const contextText = parts.join("\n\n---\n\n");

        aiMessages.push({
          role: "system",
          content: `[Context — Document Excerpts]\n\n${contextText}\n\n[Instructions]\nAnswer ONLY from the context above. ${
            intent.wantsTable
              ? "The question is about tabular data — read EVERY row of any TABLE chunk carefully before answering. List all matching entries."
              : ""
          } If user asks about a specific range/value, use ONLY that exact data. ONLY say "Not in document." after carefully scanning every chunk (especially tables). Always cite at the end: 📌 Source: [filename] | Chunk #[number] | Page [number from the [Page N] prefix].`,
        });
      } else {
        aiMessages.push({ role: "system", content: "No documents uploaded or no relevant chunks found. Tell the user to upload documents first." });
      }
    }

    aiMessages.push(...messages);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages: aiMessages, stream: true, temperature: 0 }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: response.status === 429 ? "Rate limited" : response.status === 402 ? "Credits exhausted" : "AI error" }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [stream1, stream2] = response.body!.tee();

    if (sessionId) {
      (async () => {
        try {
          const reader = stream2.getReader();
          const decoder = new TextDecoder();
          let fullContent = "";
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf("\n")) !== -1) {
              let line = buf.slice(0, idx);
              buf = buf.slice(idx + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (!line.startsWith("data: ")) continue;
              const json = line.slice(6).trim();
              if (json === "[DONE]") break;
              try { const p = JSON.parse(json); const d = p.choices?.[0]?.delta?.content; if (d) fullContent += d; } catch {}
            }
          }
          if (fullContent) {
            await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: fullContent });
          }
        } catch (e) { console.error("Save assistant msg failed:", e); }
      })();
    }

    return new Response(stream1, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("agent-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
