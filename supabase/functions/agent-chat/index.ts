import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Must match process-document exactly ──
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

// ── Hindi filler removal ──
const HINDI_FILLERS = /\b(ka|ki|ke|mai|mein|kitni|kitna|kya|hai|toh|aur|se|ko|ne|par|pe|ho|hain|tha|thi|the|bhi|nahi|nhi|karo|karo|batao|bata|dikhao)\b/gi;

function removeHindiFillers(q: string): string {
  return q.replace(HINDI_FILLERS, " ").replace(/\s+/g, " ").trim();
}

// ── Multi-query expansion: 4 variants ──
function expandQuery(query: string): string[] {
  const cleaned = removeHindiFillers(query);
  const rangeNormalized = normalizeRanges(query);
  const cleanedNormalized = normalizeRanges(cleaned);

  return Array.from(new Set([
    query,
    cleaned,
    rangeNormalized,
    cleanedNormalized + " exact value number percentage data",
  ])).filter(Boolean);
}

// ── Keyword/NLP helpers ──
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "what", "which", "who", "when", "where", "tell", "me",
  "about", "for", "from", "with", "this", "that", "these", "those", "and", "or", "to", "of", "in",
  "on", "my", "your", "please", "show", "give", "need", "do", "does", "did",
]);

const SEARCH_SYNONYMS: Record<string, string[]> = {
  subject: ["subjects", "paper", "papers", "course", "courses"],
  subjects: ["subject", "paper", "papers", "course"],
  paper: ["subject", "subjects", "course", "exam"],
  roll: ["roll number", "enrollment", "registration"],
  exam: ["examination", "test", "session"],
  date: ["day", "session", "schedule", "timing"],
  name: ["candidate", "student", "applicant"],
  marks: ["score", "result", "grade"],
  center: ["centre", "venue", "location"],
  centre: ["center", "venue", "location"],
  salary: ["income", "pay", "wage", "compensation"],
  age: ["age group", "years", "old"],
  survival: ["survival rate", "survived", "alive"],
};

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalizeForSearch(text).split(" ").filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function expandQueryTerms(query: string): string[] {
  const terms = new Set<string>(tokenize(normalizeForSearch(query)));
  for (const token of Array.from(terms)) {
    for (const syn of SEARCH_SYNONYMS[token] ?? []) terms.add(syn);
  }
  return Array.from(terms);
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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

function getReadabilityScore(text: string): number {
  const sample = text.slice(0, 1000);
  const readable = sample.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return readable / Math.max(sample.length, 1);
}

// ── System prompts ──
const SYSTEM_PROMPTS: Record<string, string> = {
  documents: `You are a precise document assistant like NotebookLM.
STRICT RULES:
1. Answer ONLY from [Context] provided. Zero outside knowledge.
2. survival RATE = percentage value (e.g. 71.59%).
   survival COUNT = number (e.g. 63). NEVER mix these.
3. If asked about age group 51-60, use ONLY 51-60 data.
   NEVER substitute with other age groups.
4. If asked about a person's section (like "Ratan Tata about"),
   use ONLY chunks containing that person's name.
5. For counting questions: count ALL unique items across ALL chunks.
6. If not found: say exactly "Not in document."
7. Always end with: 📌 Source: [filename] | Chunk #[number]
8. Keep answers concise: 2-4 sentences max.`,

  datascience: `You are a senior Data Science & ML Engineering assistant. Provide complete, runnable code with explanations.`,

  research: `You are an autonomous research agent. Break down questions into sub-tasks, provide structured reports.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, mode, sessionId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.documents;
    const userQuery = messages[messages.length - 1]?.content || "";

    // Save user message
    if (sessionId && userQuery) {
      await supabase.from("chat_history").insert({ session_id: sessionId, role: "user", message: userQuery });
    }

    const aiMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (mode === "documents" && userQuery) {
      // ── Multi-query expansion: embed all 4 variants, merge results ──
      const queryVariants = expandQuery(userQuery);
      const normalizedQuery = normalizeForSearch(userQuery);
      const queryTerms = expandQueryTerms(userQuery);

      console.log(`Query variants: ${queryVariants.length}, Terms: ${queryTerms.length}`);

      const { data: allChunks, error: chunkError } = await supabase
        .from("document_chunks")
        .select("id, document_name, chunk_index, content, embedding")
        .limit(1000);

      if (chunkError) console.error("Chunk fetch error:", JSON.stringify(chunkError));

      let rankedChunks: any[] = [];
      if (allChunks && allChunks.length > 0) {
        const readableChunks = allChunks.filter((c: any) => getReadabilityScore(c.content ?? "") > 0.2);

        if (readableChunks.length === 0) {
          aiMessages.push({ role: "system", content: "Stored document text is unreadable. Tell user to re-upload." });
        }

        // Score each chunk against ALL query variants, take max
        const chunkScores = new Map<number, any>();

        for (const variant of queryVariants) {
          const variantEmbedding = betterEmbed(variant);
          const variantNorm = normalizeForSearch(variant);
          const variantTerms = expandQueryTerms(variant);

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
            const hybrid = sim * 0.55 + kw * 0.45;

            const existing = chunkScores.get(ci);
            if (!existing || hybrid > existing.hybridScore) {
              chunkScores.set(ci, {
                document_name: c.document_name,
                chunk_index: c.chunk_index,
                content: c.content,
                similarity: sim,
                keywordScore: kw,
                hybridScore: hybrid,
              });
            }
          }
        }

        rankedChunks = Array.from(chunkScores.values())
          .filter((c) => c.hybridScore > 0.05)
          .sort((a, b) => b.hybridScore - a.hybridScore)
          .slice(0, 15);

        // Fallback: pure keyword
        if (rankedChunks.length === 0) {
          rankedChunks = readableChunks
            .map((c: any) => {
              const kw = getKeywordScore(c.content, normalizedQuery, queryTerms);
              return { document_name: c.document_name, chunk_index: c.chunk_index, content: c.content, similarity: 0, keywordScore: kw, hybridScore: kw };
            })
            .filter((c: any) => c.keywordScore > 0)
            .sort((a: any, b: any) => b.keywordScore - a.keywordScore)
            .slice(0, 15);
        }

        console.log(`Ranked ${readableChunks.length}/${allChunks.length} readable, top ${rankedChunks.length}, best: ${rankedChunks[0]?.hybridScore?.toFixed(4) ?? "0"}`);
      }

      if (rankedChunks.length > 0) {
        const contextText = rankedChunks
          .map((c: any) =>
            `[Chunk #${c.chunk_index} | File: ${c.document_name} | Relevance: ${(c.hybridScore * 100).toFixed(1)}%]\n${c.content}`
          )
          .join("\n\n---\n\n");
        aiMessages.push({
          role: "system",
          content: `[Context — Document Excerpts]\n\n${contextText}\n\n[Instructions]\nAnswer ONLY from the context above. If user asks about a specific data point, find it EXACTLY. Always cite: 📌 Source: [filename] | Chunk #[number]`,
        });
      } else {
        aiMessages.push({ role: "system", content: "No documents uploaded or no relevant chunks found. Tell the user to upload documents first." });
      }
    }

    aiMessages.push(...messages);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: aiMessages, stream: true, temperature: 0 }),
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

    // Background: save assistant response to chat_history
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
        } catch (e) {
          console.error("Failed to save assistant message:", e);
        }
      })();
    }

    return new Response(stream1, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("agent-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
