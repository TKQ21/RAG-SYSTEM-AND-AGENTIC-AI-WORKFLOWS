import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Must match process-document's embedding function exactly
function simpleEmbed(text: string): number[] {
  const vec = new Array(384).fill(0);
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    vec[i % 384] += lower.charCodeAt(i) / 1000;
  }
  for (let i = 0; i < lower.length - 1; i++) {
    const bigram = lower.charCodeAt(i) * 31 + lower.charCodeAt(i + 1);
    vec[(bigram) % 384] += 0.5 / 1000;
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
};

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeForSearch(text)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function expandQueryTerms(query: string): string[] {
  const normalizedQuery = normalizeForSearch(query);
  const terms = new Set<string>(tokenize(normalizedQuery));

  for (const token of Array.from(terms)) {
    for (const synonym of SEARCH_SYNONYMS[token] ?? []) {
      terms.add(synonym);
    }
  }

  if (normalizedQuery.includes("paper details")) {
    ["subject", "subjects", "paper", "papers", "course", "date", "session", "code"].forEach((term) => terms.add(term));
  }

  if (normalizedQuery.includes("what subject") || normalizedQuery.includes("which subject")) {
    ["subject", "subjects", "paper", "papers", "course", "course code", "subject code"].forEach((term) => terms.add(term));
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

    if (term.includes(" ")) {
      if (normalizedChunk.includes(term)) score += 1.25;
      continue;
    }

    if (chunkTokens.has(term)) score += 1;
    else if (normalizedChunk.includes(term)) score += 0.5;
  }

  return Math.min(1, score / Math.max(3, queryTerms.length * 0.8));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  documents: `You are an expert RAG AI assistant like NotebookLM. You answer questions ONLY from the document content provided below.

Rules:
- NEVER make up information. Only use what's in the document chunks.
- If the answer is not in the documents, say "This information is not found in the uploaded documents."
- Quote relevant text verbatim using blockquotes when possible
- For structured data (tables, lists, subjects, marks), reproduce them as markdown
- Understand semantic meaning: "what subjects" should find subject lists even if not labeled as such
- Cite the source document name for each piece of information
- Format with markdown: headers, bold, bullets, code blocks, tables`,

  datascience: `You are a senior Data Science & ML Engineering assistant. Provide complete, runnable code with explanations. Use pandas, scikit-learn, PyTorch, TensorFlow etc.`,

  research: `You are an autonomous research agent. Break down questions into sub-tasks, provide structured reports with Executive Summary, Key Findings, and Recommendations.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, mode } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.documents;
    const userQuery = messages[messages.length - 1]?.content || "";

    const aiMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    // For documents mode, perform semantic search
    if (mode === "documents" && userQuery) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const queryEmbedding = simpleEmbed(userQuery);
      const normalizedQuery = normalizeForSearch(userQuery);
      const queryTerms = expandQueryTerms(userQuery);

      // Fetch all chunks and rank by cosine similarity in JS
      const { data: allChunks, error: chunkError } = await supabase
        .from("document_chunks")
        .select("id, document_name, chunk_index, content, embedding")
        .limit(1000);

      if (chunkError) {
        console.error("Chunk fetch error:", JSON.stringify(chunkError));
      }

      let rankedChunks: any[] = [];
      if (allChunks && allChunks.length > 0) {
        const readableChunks = allChunks.filter((chunk: any) => getReadabilityScore(chunk.content ?? "") > 0.2);

        if (readableChunks.length === 0) {
          aiMessages.push({
            role: "system",
            content: "The stored document text is unreadable, likely because the PDF was uploaded as raw binary instead of extracted text. Tell the user to re-upload the document.",
          });
          console.log("All stored chunks are unreadable for current documents");
        }

        rankedChunks = readableChunks
          .map((c: any) => {
            let sim = 0;
            if (c.embedding) {
              let emb: number[];
              try {
                // pgvector returns "[0.1,0.2,...]" string
                const raw = typeof c.embedding === "string" ? c.embedding : String(c.embedding);
                emb = JSON.parse(raw);
              } catch { emb = []; }
              if (emb.length === queryEmbedding.length) sim = cosineSimilarity(emb, queryEmbedding);
            }

            const keywordScore = getKeywordScore(c.content, normalizedQuery, queryTerms);
            const hybridScore = sim * 0.65 + keywordScore * 0.35;

            return {
              document_name: c.document_name,
              chunk_index: c.chunk_index,
              content: c.content,
              similarity: sim,
              keywordScore,
              hybridScore,
            };
          })
          .filter((chunk: any) => chunk.hybridScore > 0.08)
          .sort((a: any, b: any) => b.hybridScore - a.hybridScore)
          .slice(0, 12);

        if (rankedChunks.length === 0) {
          rankedChunks = readableChunks
            .map((c: any) => ({
              document_name: c.document_name,
              chunk_index: c.chunk_index,
              content: c.content,
              similarity: 0,
              keywordScore: getKeywordScore(c.content, normalizedQuery, queryTerms),
              hybridScore: getKeywordScore(c.content, normalizedQuery, queryTerms),
            }))
            .filter((chunk: any) => chunk.keywordScore > 0)
            .sort((a: any, b: any) => b.keywordScore - a.keywordScore)
            .slice(0, 12);
        }

        console.log(`Ranked ${readableChunks.length}/${allChunks.length} readable chunks, top hybrid: ${rankedChunks[0]?.hybridScore?.toFixed(4) ?? "0.0000"}`);
      }

      if (rankedChunks.length > 0) {
        const contextText = rankedChunks
          .map((c: any) => `[Source: ${c.document_name}, Chunk #${c.chunk_index}, Relevance: ${(c.hybridScore * 100).toFixed(1)}%]\n${c.content}`)
          .join("\n\n---\n\n");

        aiMessages.push({
          role: "system",
          content: `Retrieved document chunks via semantic search:\n\n${contextText}\n\nAnswer ONLY from these chunks. Cite the source document name.`,
        });
      } else {
        aiMessages.push({
          role: "system",
          content: "No documents uploaded or no relevant chunks found. Tell the user to upload documents first.",
        });
        console.log("No chunks found for query");
      }
    }

    aiMessages.push(...messages);

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: aiMessages,
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: response.status === 429 ? "Rate limited" : response.status === 402 ? "Credits exhausted" : "AI error" }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
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
