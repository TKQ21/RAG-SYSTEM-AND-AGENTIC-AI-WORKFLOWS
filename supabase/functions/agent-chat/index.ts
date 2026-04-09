import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// TF-IDF style embedding - must match process-document exactly
function betterEmbed(text: string): number[] {
  const vec = new Array(384).fill(0);
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  const wordCount: Record<string, number> = {};
  for (const w of words) {
    wordCount[w] = (wordCount[w] || 0) + 1;
  }

  for (const [word, count] of Object.entries(wordCount)) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash;
    }
    const idx = Math.abs(hash) % 384;
    vec[idx] += count * Math.log(1 + count);

    const idx2 = (Math.abs(hash * 31)) % 384;
    vec[idx2] += count * 0.5;
  }

  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "what", "which", "who", "when", "where", "tell", "me",
  "about", "for", "from", "with", "this", "that", "these", "those", "and", "or", "to", "of", "in",
  "on", "my", "your", "please", "show", "give", "need", "do", "does", "did",
]);

const SEARCH_SYNONYMS: Record<string, string[]> = {
  subject: ["subjects", "paper", "papers", "course", "courses", "topic", "topics", "subject code", "paper code"],
  subjects: ["subject", "paper", "papers", "course", "courses", "subject code", "paper code"],
  paper: ["subject", "subjects", "course", "courses", "exam", "examination", "paper code"],
  papers: ["paper", "subject", "subjects", "course", "courses", "exam", "examination"],
  details: ["detail", "information", "info", "record", "summary", "data"],
  roll: ["roll", "number", "roll no", "roll number", "enrollment", "enrolment", "registration"],
  exam: ["exam", "examination", "test", "session", "schedule", "paper"],
  date: ["date", "day", "session", "schedule", "timing", "time"],
  name: ["name", "candidate", "student", "applicant"],
  marks: ["marks", "score", "result", "grade"],
  center: ["center", "centre", "venue", "location"],
  centre: ["center", "centre", "venue", "location"],
  salary: ["salary", "income", "pay", "wage", "compensation", "earning"],
  age: ["age", "age group", "years", "old"],
};

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): string[] {
  return normalizeForSearch(text).split(" ").filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function expandQueryTerms(query: string): string[] {
  const normalizedQuery = normalizeForSearch(query);
  const terms = new Set<string>(tokenize(normalizedQuery));
  for (const token of Array.from(terms)) {
    for (const synonym of SEARCH_SYNONYMS[token] ?? []) terms.add(synonym);
  }
  return Array.from(terms);
}

function getReadabilityScore(text: string): number {
  const sample = text.slice(0, 1000);
  const readable = sample.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return readable / Math.max(sample.length, 1);
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

const SYSTEM_PROMPTS: Record<string, string> = {
  documents: `You are a strict document QA system.
ONLY answer from the exact [Context] given.
If context has '40-50 age group' data, answer that.
If context has '60-70 age group' data, answer that.
NEVER mix data from different sections.
NEVER guess or hallucinate.
If exact data not found: say 'Not in document.'
Be specific and accurate.
Always cite: [Source: filename, Chunk #idx]`,

  datascience: `You are a senior Data Science & ML Engineering assistant. Provide complete, runnable code with explanations.`,

  research: `You are an autonomous research agent. Break down questions into sub-tasks, provide structured reports.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
      await supabase.from("chat_history").insert({
        session_id: sessionId,
        role: "user",
        message: userQuery,
      });
    }

    const aiMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (mode === "documents" && userQuery) {
      const queryEmbedding = betterEmbed(userQuery);
      const normalizedQuery = normalizeForSearch(userQuery);
      const queryTerms = expandQueryTerms(userQuery);

      const { data: allChunks, error: chunkError } = await supabase
        .from("document_chunks")
        .select("id, document_name, chunk_index, content, embedding")
        .limit(1000);

      if (chunkError) console.error("Chunk fetch error:", JSON.stringify(chunkError));

      let rankedChunks: any[] = [];
      if (allChunks && allChunks.length > 0) {
        const readableChunks = allChunks.filter((c: any) => getReadabilityScore(c.content ?? "") > 0.2);

        if (readableChunks.length === 0) {
          aiMessages.push({ role: "system", content: "The stored document text is unreadable. Tell the user to re-upload the document." });
        }

        rankedChunks = readableChunks
          .map((c: any) => {
            let sim = 0;
            if (c.embedding) {
              let emb: number[];
              try {
                const raw = typeof c.embedding === "string" ? c.embedding : String(c.embedding);
                emb = JSON.parse(raw);
              } catch { emb = []; }
              if (emb.length === queryEmbedding.length) sim = cosineSimilarity(emb, queryEmbedding);
            }
            const keywordScore = getKeywordScore(c.content, normalizedQuery, queryTerms);
            const hybridScore = sim * 0.55 + keywordScore * 0.45;
            return { document_name: c.document_name, chunk_index: c.chunk_index, content: c.content, similarity: sim, keywordScore, hybridScore };
          })
          .filter((c: any) => c.hybridScore > 0.05)
          .sort((a: any, b: any) => b.hybridScore - a.hybridScore)
          .slice(0, 12);

        // Fallback to pure keyword
        if (rankedChunks.length === 0) {
          rankedChunks = readableChunks
            .map((c: any) => ({
              document_name: c.document_name, chunk_index: c.chunk_index, content: c.content,
              similarity: 0, keywordScore: getKeywordScore(c.content, normalizedQuery, queryTerms),
              hybridScore: getKeywordScore(c.content, normalizedQuery, queryTerms),
            }))
            .filter((c: any) => c.keywordScore > 0)
            .sort((a: any, b: any) => b.keywordScore - a.keywordScore)
            .slice(0, 12);
        }

        console.log(`Ranked ${readableChunks.length}/${allChunks.length} readable, top ${rankedChunks.length} chunks, best: ${rankedChunks[0]?.hybridScore?.toFixed(4) ?? "0"}`);
      }

      if (rankedChunks.length > 0) {
        const contextText = rankedChunks
          .map((c: any) => `[Source: ${c.document_name}, Chunk #${c.chunk_index}, Relevance: ${(c.hybridScore * 100).toFixed(1)}%]\n${c.content}`)
          .join("\n\n---\n\n");
        aiMessages.push({ role: "system", content: `[Context]\n\n${contextText}\n\nAnswer ONLY from the context above. Cite source with chunk number.` });
      } else {
        aiMessages.push({ role: "system", content: "No documents uploaded or no relevant chunks found. Tell the user to upload documents first." });
      }
    }

    aiMessages.push(...messages);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: aiMessages, stream: true }),
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
              try {
                const p = JSON.parse(json);
                const d = p.choices?.[0]?.delta?.content;
                if (d) fullContent += d;
              } catch {}
            }
          }
          if (fullContent) {
            await supabase.from("chat_history").insert({
              session_id: sessionId,
              role: "assistant",
              message: fullContent,
            });
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
