import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Message = { role: "system" | "user" | "assistant"; content: string };
type RetrievedChunk = {
  id: string;
  document_id: string;
  document_name: string;
  content: string;
  chunk_index: number;
  page_num?: number;
  start_char?: number;
  end_char?: number;
  similarity: number;
  keywordScore?: number;
  hybridScore?: number;
};

function normalizeQuery(query: string): string {
  return String(query || "")
    .toLowerCase()
    .replace(/(\d+)\s*[-–—]\s*(\d+)/g, "$1 to $2 age group")
    .replace(/\b(ka|ki|ke|mai|mein|me|kya|hai|toh|aur|se|ko|kitni|kitna|batao|please|yr|yaar)\b/gi, " ")
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
  const words = normalizeQuery(text).split(/\s+/).filter((word) => word.length > 2);
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

function keywords(text: string): string[] {
  return normalizeQuery(text)
    .split(/\s+/)
    .filter((word) => word.length > 2 && !/^(the|and|for|with|from|this|that|what|which|how|who|name|result|pdf|document|data)$/.test(word));
}

function keywordScore(question: string, content: string): number {
  const qWords = keywords(question);
  if (qWords.length === 0) return 0;
  const haystack = ` ${normalizeQuery(content)} `;
  let score = 0;
  for (const word of qWords) {
    if (haystack.includes(` ${word} `)) score += 1;
    else if (word.length > 4 && haystack.includes(word)) score += 0.5;
  }

  const ranges = question.match(/\d+\s*[-–—]\s*\d+/g) || [];
  for (const range of ranges) {
    const [a, b] = range.split(/[-–—]/).map((n) => n.trim());
    if (new RegExp(`\\b${a}\\s*(?:-|–|—|to)\\s*${b}\\b`, "i").test(content)) score += 4;
  }

  return Math.min(1, score / Math.max(2, qWords.length));
}

async function analyzeIntent(question: string, lovableKey: string): Promise<{ concepts: string[]; variants: string[]; wantsTable: boolean; exactRange?: string }> {
  const fallback = buildQueryVariants(question, null);
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Convert the user's Hindi/English/Hinglish document question into retrieval intent JSON only. Fields: concepts string[], variants string[] exactly 4 concise semantic search queries, wantsTable boolean, exactRange string|null. Preserve exact names, ranges, numbers, and labels.",
          },
          { role: "user", content: question },
        ],
      }),
    });

    if (!response.ok) throw new Error(`intent ${response.status}`);
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    return {
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts.slice(0, 8).map(String) : [],
      variants: Array.isArray(parsed.variants) ? parsed.variants.slice(0, 4).map(String) : fallback,
      wantsTable: Boolean(parsed.wantsTable),
      exactRange: parsed.exactRange ? String(parsed.exactRange) : undefined,
    };
  } catch (error) {
    console.error("intent analysis fallback:", error);
    return { concepts: keywords(question).slice(0, 8), variants: fallback, wantsTable: /table|row|column|list|all|kitn|rate|percentage|%/i.test(question), exactRange: question.match(/\d+\s*[-–—]\s*\d+/)?.[0] };
  }
}

function buildQueryVariants(question: string, intent: { concepts?: string[]; exactRange?: string } | null): string[] {
  const normalized = normalizeQuery(question);
  const rangeVariant = question.replace(/\d+\s*[-–—]\s*\d+/g, (match) => `${match} age group data point exact value`);
  const conceptText = intent?.concepts?.join(" ") || keywords(question).join(" ");

  return Array.from(new Set([
    normalized,
    question,
    `${normalized} exact value number percentage`,
    rangeVariant,
    `${conceptText} table row label value`,
    intent?.exactRange ? `${intent.exactRange} exact range` : "",
  ].filter(Boolean))).slice(0, 6);
}

function strictPrompt(): string {
  return `You are a strict NotebookLM-style document intelligence assistant.

CRITICAL GROUNDING RULES:
1. Answer ONLY from [Context]. Never use outside knowledge, memory, or assumptions.
2. First understand the semantic intent in English/Hindi/Hinglish, then map it to exact context chunks.
3. If user asks about a SPECIFIC range like 41-50, answer ONLY from 41-50 chunks. NEVER use 71+, another range, or nearby data as substitute.
4. If the exact asked range/entity/field is not in context, say exactly: "This specific range is not in the document."
5. If the answer is generally absent, say exactly: "I could not find a relevant answer in the provided documents."
6. If multiple values exist for the same range/entity, list ALL values with exact labels.
7. "rate" means percentage only. "count" means integer only. Never mix them.
8. Read table chunks row-by-row and preserve labels.
9. Keep answer short: 2-4 sentences unless listing items.
10. STUDENT RESULT QUERIES: For questions like "Mohd Kaif ka result", "[name] ka result", or any roll/enrollment number lookup:
    - Match by student NAME, Roll No, AND Enrollment No interchangeably (e.g., "MOHD KAIF" and "25345201387" refer to the same student).
    - Report ALL grades, every subject, SGPA, total credits, and result status found for that student.
    - List subjects line-by-line preserving Paper Code, Paper Name, Grade, and Credit Points exactly.
11. Every answer must end with citations, one per line, max 3:
📌 Source: [filename] | Chunk #[n] | Page [n]
Temperature is 0: deterministic extraction, no guessing.`;
}

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks.map((chunk) =>
    `[Chunk #${chunk.chunk_index} | File: ${chunk.document_name} | Page: ${chunk.page_num ?? 1} | Semantic: ${Math.round((chunk.similarity || 0) * 100)}% | Keyword: ${Math.round((chunk.keywordScore || 0) * 100)}%]\n${chunk.content}`
  ).join("\n\n---\n\n").slice(0, 18000);
}

async function saveAssistantResponse(stream: ReadableStream<Uint8Array>, supabase: any, sessionId: string) {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;

      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (json === "[DONE]") break;
        try {
          const parsed = JSON.parse(json);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) full += delta;
        } catch {}
      }
    }

    if (full.trim()) await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: full });
  } catch (error) {
    console.error("assistant history save failed:", error);
  }
}

const PROMPT_DS = `You are a senior Data Science & ML Engineering assistant. Provide complete, runnable code with concise explanations.`;
const PROMPT_RES = `You are an autonomous research agent. Break down questions into sub-tasks and provide structured reports with citations.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE) throw new Error("LOVABLE_API_KEY missing");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { messages, mode, sessionId } = await req.json();
    const safeMessages: Message[] = Array.isArray(messages) ? messages : [];
    const userQuery = String(safeMessages[safeMessages.length - 1]?.content || "").trim();

    if (sessionId && userQuery) {
      await supabase.from("chat_history").insert({ session_id: sessionId, role: "user", message: userQuery });
    }

    const aiMessages: Message[] = [{ role: "system", content: mode === "datascience" ? PROMPT_DS : mode === "research" ? PROMPT_RES : strictPrompt() }];

    if (mode === "documents" && userQuery) {
      const intent = await analyzeIntent(userQuery, LOVABLE);
      const variants = buildQueryVariants(userQuery, intent);
      const seen = new Map<string, RetrievedChunk>();

      for (const variant of variants) {
        const embedding = betterEmbed(variant);
        const { data, error } = await supabase.rpc("match_document_chunks", {
          query_embedding: JSON.stringify(embedding) as any,
          match_threshold: 0.01,
          match_count: 40,
        });

        if (error) {
          console.error("match_document_chunks failed:", error.message);
          continue;
        }

        for (const rawChunk of (data || []) as RetrievedChunk[]) {
          const kScore = keywordScore(`${userQuery} ${intent.concepts.join(" ")} ${intent.exactRange || ""}`, rawChunk.content);
          const tableBoost = intent.wantsTable && /[:|%]|\d+\s*[-–—]\s*\d+/.test(rawChunk.content) ? 0.08 : 0;
          const rangePenalty = intent.exactRange && !keywordScore(intent.exactRange, rawChunk.content) ? -0.2 : 0;
          const hybridScore = (rawChunk.similarity * 0.55) + (kScore * 0.45) + tableBoost + rangePenalty;
          const chunk = { ...rawChunk, keywordScore: kScore, hybridScore };
          const previous = seen.get(chunk.id);
          if (!previous || (chunk.hybridScore || 0) > (previous.hybridScore || 0)) seen.set(chunk.id, chunk);
        }
      }

      let chunks = Array.from(seen.values())
        .filter((chunk) => (chunk.hybridScore || 0) >= 0.03 || (chunk.keywordScore || 0) > 0)
        .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))
        .slice(0, 20);

      if (intent.exactRange) {
        const exact = chunks.filter((chunk) => keywordScore(intent.exactRange!, chunk.content) > 0);
        if (exact.length > 0) chunks = exact.concat(chunks.filter((chunk) => !exact.some((e) => e.id === chunk.id))).slice(0, 20);
      }

      console.log(JSON.stringify({ event: "retrieval", query: userQuery, variants, chunks: chunks.length, top: chunks[0] ? { chunk: chunks[0].chunk_index, score: chunks[0].hybridScore, sim: chunks[0].similarity, keyword: chunks[0].keywordScore } : null }));

      if (chunks.length > 0) {
        aiMessages.push({
          role: "system",
          content: `[Context]\n${buildContext(chunks)}\n\n[User Question]\n${userQuery}\n\n[Instruction]\nUse only the context. If the exact range/entity/field is missing, say the required fallback. End with 📌 citations including filename, chunk number, and page number.`,
        });
      } else {
        aiMessages.push({ role: "system", content: "No relevant chunks were retrieved. Reply exactly: I could not find a relevant answer in the provided documents." });
      }
    }

    aiMessages.push(...safeMessages);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages: aiMessages, stream: true, temperature: 0 }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      const message = response.status === 429 ? "Rate limits exceeded, please try again later." : response.status === 402 ? "Lovable AI credits exhausted. Please add credits in Workspace Usage." : "AI response failed.";
      return new Response(JSON.stringify({ error: message }), { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!response.body) throw new Error("AI response stream missing");
    const [clientStream, historyStream] = response.body.tee();
    if (sessionId) saveAssistantResponse(historyStream, supabase, sessionId);

    return new Response(clientStream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (error) {
    console.error("agent-chat:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
