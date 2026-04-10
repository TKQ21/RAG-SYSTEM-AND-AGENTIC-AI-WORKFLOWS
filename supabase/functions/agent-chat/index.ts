import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Gemini Embedding (768-dim) — must match process-document ──
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

// ── Hindi filler removal ──
const HINDI_FILLERS = /\b(ka|ki|ke|mai|mein|kitni|kitna|kya|hai|toh|aur|se|ko|ne|par|pe|ho|hain|tha|thi|the|bhi|nahi|nhi|karo|batao|bata|dikhao)\b/gi;

function removeHindiFillers(q: string): string {
  return q.replace(HINDI_FILLERS, " ").replace(/\s+/g, " ").trim();
}

function normalizeRanges(text: string): string {
  return text.replace(/(\d+)\s*[-–—]\s*(\d+)/g, "$1 to $2 age group");
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

// ── Keyword helpers ──
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "what", "which", "who", "when", "where", "tell", "me",
  "about", "for", "from", "with", "this", "that", "these", "those", "and", "or", "to", "of", "in",
  "on", "my", "your", "please", "show", "give", "need", "do", "does", "did",
]);

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalizeForSearch(text).split(" ").filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function getKeywordScore(chunkText: string, queryTerms: string[]): number {
  const normalizedChunk = normalizeForSearch(chunkText);
  const chunkTokens = new Set(tokenize(normalizedChunk));
  let score = 0;
  for (const term of queryTerms) {
    if (!term) continue;
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

// ── System prompts ──
const SYSTEM_PROMPTS: Record<string, string> = {
  documents: `You are a precise document Q&A assistant (NotebookLM-style).

CRITICAL RULES — Follow exactly:
1. Answer ONLY from the [Context] chunks provided below.
2. NEVER use outside knowledge. NEVER guess. NEVER estimate.
3. If user asks about a SPECIFIC range like "41-50", answer ONLY with 41-50 data.
   NEVER substitute with 71+ or any other range.
4. If document has multiple values for same category, list ALL of them.
5. If exact data not found in context: say exactly "Not in document."
6. Keep answers SHORT — 2-4 sentences max (unless listing data).
7. Temperature is 0 — be deterministic, not creative.

NUMERIC PRECISION RULES:
- "survival rate" = percentage (e.g. 71.59%)
- "survival count" = number (e.g. 63)
- "average age" = decimal number (e.g. 58.76)
- NEVER give count when rate is asked
- NEVER give rate when count is asked
- These are DIFFERENT metrics, never mix them

SUBJECT COUNTING RULES:
- Count subjects from the MAIN TABLE only
- Each ROW in the main table = ONE subject
- Do NOT count from any other section
- If same subject appears twice = count ONCE only

ENTITY-SECTION MATCHING:
- When question contains a person/company name AND a section name:
  Answer ONLY from chunks where BOTH appear
- NEVER answer from a different entity's section

CITATION FORMAT (mandatory):
After your answer, always write:
📌 Source: [filename] | Chunk #[number] | Page [number]
If multiple sources: list each on a new line.`,

  datascience: `You are a senior Data Science & ML Engineering assistant. Provide complete, runnable code with explanations.`,
  research: `You are an autonomous research agent. Break down questions into sub-tasks, provide structured reports.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, mode, sessionId } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
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

    if (mode === "documents" && userQuery && GEMINI_API_KEY) {
      // ── Multi-query: embed all variants with Gemini, search via pgvector ──
      const queryVariants = expandQuery(userQuery);
      const queryTerms = tokenize(normalizeForSearch(userQuery));

      console.log(`Query variants: ${queryVariants.length}, Terms: ${queryTerms.join(",")}`);

      // Embed first variant for pgvector search
      let queryEmbedding: number[] | null = null;
      try {
        queryEmbedding = await getGeminiEmbedding(queryVariants[0], GEMINI_API_KEY);
      } catch (embErr) {
        console.error("Query embedding failed:", embErr);
      }

      let rankedChunks: any[] = [];

      if (queryEmbedding) {
        // Use pgvector match function for semantic search
        const { data: semanticResults, error: matchError } = await supabase
          .rpc("match_document_chunks", {
            query_embedding: JSON.stringify(queryEmbedding),
            match_threshold: 0.3,
            match_count: 15,
          });

        if (matchError) {
          console.error("match_document_chunks error:", matchError);
        }

        if (semanticResults && semanticResults.length > 0) {
          rankedChunks = semanticResults.map((r: any) => ({
            document_name: r.document_name,
            chunk_index: r.chunk_index,
            content: r.content,
            similarity: r.similarity,
            keywordScore: getKeywordScore(r.content, queryTerms),
            hybridScore: r.similarity * 0.6 + getKeywordScore(r.content, queryTerms) * 0.4,
          }));
          rankedChunks.sort((a: any, b: any) => b.hybridScore - a.hybridScore);
        }
      }

      // Fallback: keyword-only search if no semantic results
      if (rankedChunks.length === 0) {
        const { data: allChunks } = await supabase
          .from("document_chunks")
          .select("document_name, chunk_index, content")
          .limit(500);

        if (allChunks && allChunks.length > 0) {
          rankedChunks = allChunks
            .map((c: any) => {
              const kw = getKeywordScore(c.content, queryTerms);
              return { ...c, similarity: 0, keywordScore: kw, hybridScore: kw };
            })
            .filter((c: any) => c.keywordScore > 0)
            .sort((a: any, b: any) => b.keywordScore - a.keywordScore)
            .slice(0, 15);
        }
      }

      console.log(`Retrieved ${rankedChunks.length} chunks, best: ${rankedChunks[0]?.hybridScore?.toFixed(4) ?? "0"}`);

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
    } else if (mode === "documents" && userQuery && !GEMINI_API_KEY) {
      aiMessages.push({ role: "system", content: "GEMINI_API_KEY is not configured. Document search unavailable." });
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

    // Background: save assistant response
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
