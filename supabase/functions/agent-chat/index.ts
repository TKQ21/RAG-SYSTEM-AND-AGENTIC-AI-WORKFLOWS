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
  similarity: number;
  keywordScore?: number;
  hybridScore?: number;
};

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gatewayFetch(path: string, body: unknown, attempts = 2): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(`${GATEWAY}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) return res;
    last = res;
    await wait(700 * (attempt + 1));
  }
  return last!;
}

async function embed(text: string, _taskType = "RETRIEVAL_QUERY"): Promise<number[] | null> {
  try {
    const res = await gatewayFetch("/embeddings", {
      model: "openai/text-embedding-3-small",
      input: text.slice(0, 8000),
      dimensions: 768,
    });
    if (!res.ok) {
      console.error("embed failed", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = await res.json();
    return json.data?.[0]?.embedding || null;
  } catch (e) {
    console.error("embed err", e);
    return null;
  }
}

async function embedMany(texts: string[]): Promise<(number[] | null)[]> {
  if (!texts.length) return [];
  try {
    const res = await gatewayFetch("/embeddings", {
      model: "openai/text-embedding-3-small",
      input: texts.map((t) => t.slice(0, 8000)),
      dimensions: 768,
    });
    if (!res.ok) {
      console.error("embed many failed", res.status, (await res.text()).slice(0, 200));
      return Promise.all(texts.map((t) => embed(t)));
    }
    const json = await res.json();
    const byIndex = new Map<number, number[]>();
    for (const item of json.data || []) byIndex.set(item.index ?? 0, item.embedding || null);
    return texts.map((_, i) => byIndex.get(i) || null);
  } catch (e) {
    console.error("embed many err", e);
    return Promise.all(texts.map((t) => embed(t)));
  }
}

function normalizeQuery(q: string): string {
  return String(q || "")
    .toLowerCase()
    .replace(/\b(ka|ki|ke|mai|mein|me|kya|hai|toh|aur|se|ko|kitni|kitna|batao|please|yr|yaar|likha|bata|do|kar|kare|wala|wale|wali|section|dashboard)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywords(text: string): string[] {
  // preserve numeric ranges like 40-50, 41-50, 71+
  return normalizeQuery(text)
    .replace(/[^\p{L}\p{N}\-+\s]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-+]+|[-+]+$/g, (m) => (/\d/.test(w) ? m : "")))
    .filter((w) => w.length >= 2 && !/^(the|and|for|with|from|this|that|what|which|how|who|pdf|document|about)$/.test(w));
}

function expandedKeywords(question: string): string[] {
  const base = keywords(question);
  const q = normalizeQuery(question);
  const extras: string[] = [];

  // Hinglish/semantic bridge: users often call marksheets / statements "admit card" or ask "kis person ka hai".
  // The extracted document usually contains fields like Name, Exam Roll No, Enrollment No instead.
  if (/(admit\s*card|marksheet|mark\s*sheet|result|grade\s*card|person|candidate|student|naam|name|kiska|kis)/i.test(q)) {
    extras.push("name", "father", "mother", "enrollment", "roll", "course", "semester", "college");
  }
  if (/(subject|paper|exam|date|time|timing|details?)/i.test(q)) {
    extras.push("paper", "subject", "exam", "date", "time", "code", "commerce", "management", "business");
  }

  return Array.from(new Set([...base, ...extras].filter((w) => w.length >= 2)));
}

function keywordScore(question: string, content: string): number {
  const qWords = expandedKeywords(question);
  if (qWords.length === 0) return 0;
  const haystack = ` ${content.toLowerCase()} `;
  let score = 0;
  let numericHits = 0;
  let numericTotal = 0;
  for (const word of qWords) {
    const isNumeric = /\d/.test(word);
    if (isNumeric) numericTotal += 1;
    if (haystack.includes(word)) {
      score += isNumeric ? 2 : 1; // numeric tokens (40-50, 71+, roll numbers) weigh more
      if (isNumeric) numericHits += 1;
    }
  }
  const base = score / (qWords.length + numericTotal); // normalise with numeric boost
  // strong bonus when ALL numeric tokens are present in the chunk
  const numericBonus = numericTotal > 0 && numericHits === numericTotal ? 0.4 : 0;
  return Math.min(1, base + numericBonus);
}

function buildVariants(question: string): string[] {
  const norm = normalizeQuery(question);
  const expanded = expandedKeywords(question).join(" ");
  return Array.from(new Set([question, norm, keywords(question).join(" "), expanded].filter((s) => s && s.length > 1)));
}

async function keywordFallbackSearch(supabase: any, question: string, userId: string): Promise<RetrievedChunk[]> {
  const terms = expandedKeywords(question)
    .filter((term) => term.length >= 3 && !/^(isme|kis|kya|hai)$/.test(term))
    .slice(0, 14);
  if (!terms.length) return [];

  const orFilter = terms
    .map((term) => `content.ilike.%${term.replace(/[%,()]/g, " ").trim()}%`)
    .filter(Boolean)
    .join(",");
  if (!orFilter) return [];

  const { data, error } = await supabase
    .from("document_chunks")
    .select("id,document_id,document_name,content,chunk_index,page_num")
    .eq("user_id", userId)
    .or(orFilter)
    .limit(60);
  if (error) {
    console.error("keyword fallback failed:", error.message);
    return [];
  }
  return ((data || []) as any[])
    .map((row) => {
      const kScore = keywordScore(question, row.content);
      return { ...row, similarity: Math.max(0.65, kScore), keywordScore: kScore, hybridScore: kScore };
    })
    .filter((row) => (row.keywordScore || 0) > 0)
    .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0));
}

function strictPrompt(): string {
  return `You are a strict NotebookLM-style document intelligence assistant.

CRITICAL RULES:
1. Answer ONLY from [Context]. Never use outside knowledge.
2. Understand the user's semantic intent in English/Hindi/Hinglish, then map it to the relevant context chunks.
3. If the answer is not in the context, say exactly: "I could not find a relevant answer in the provided documents."
4. If multiple values exist, list ALL of them with exact labels.
5. POWER BI / CHART TABLES: exported text from Power BI charts is UNRELIABLE for index alignment because bars are usually drawn sorted by VALUE DESCENDING while the legend keeps a different order. NEVER assume label[i] pairs with value[i]. Instead:
   (a) Find the chart title (e.g. "Survival rate by Age Group").
   (b) Read both the category list and the numeric value list under that title.
   (c) Sort the values in DESCENDING order. The largest value belongs to the FIRST visible bar. The chart's category list is usually already in that descending order — pair them in the order they appear (label[0]↔valueDesc[0], label[1]↔valueDesc[1], ...).
   (d) Show the full mapping you derived ("Categories: [...]  Values (sorted desc): [...]") before stating the final answer for the requested category.
   Example: chart "Survival rate by Age Group" labels "61-70 40-50 51-60 BELOW 40 71+" with values "75.90% 40.38% 71.59% 74.32% 50.00%". After sorting values descending: 75.90, 74.32, 71.59, 50.00, 40.38 → 61-70=75.90%, 40-50=74.32%, 51-60=71.59%, BELOW 40=50.00%, 71+=40.38%.
6. For "about / biography / introduction / overview / who is / kaun hai / bare mai / baare mai" questions, return EVERY biographical sentence in the context (birth, family, education, career, awards, philanthropy). Do NOT truncate, do NOT summarise — copy verbatim and stitch consecutive chunks. Aim for a complete multi-paragraph answer (200+ words) when the source has it.
7. Keep answers concise (2-4 sentences) ONLY for narrow single-fact questions. For "about / list / all / full / summary / detail" questions give the complete answer.
8. Match student NAME, Roll No, and Enrollment No interchangeably (e.g., "MOHD KAIF" and "25345201387" refer to the same student). Report all subjects, grades, SGPA, and result status found.
9. If the user says "admit card", "person", "candidate", "student", "naam/name", and the context has a marksheet/result/statement of marks, answer from the Name / Father's Name / Roll No / Enrollment / Course fields instead of rejecting it.
10. End every answer with citations, max 3, one per line:
📌 Source: [filename] | Chunk #[n]
Temperature is 0: deterministic, no guessing.`;
}

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (c) =>
        `[Chunk #${c.chunk_index} | File: ${c.document_name} | Sim: ${Math.round((c.similarity || 0) * 100)}% | KW: ${Math.round((c.keywordScore || 0) * 100)}%]\n${c.content}`,
    )
    .join("\n\n---\n\n")
    .slice(0, 32000);
}

function escapeSse(text: string): Uint8Array {
  const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return new TextEncoder().encode(payload);
}

function sseTextResponse(text: string): Response {
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(escapeSse(text)); controller.close(); } }), {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}

function deterministicFallback(question: string, chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "I could not find a relevant answer in the provided documents.";
  const q = question.toLowerCase();
  const context = chunks.map((c) => c.content).join("\n");
  const source = chunks[0];

  if (/question\s*paper\s*booklet|booklet\s*no|booklet\s*number/i.test(q)) {
    const match = context.match(/Question\s*Paper\s*Booklet\s*No\.?\s*[:\-]?\s*([A-Za-z0-9]+)/i);
    if (match) return `Question Paper Booklet No. ${match[1]} hai.\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
  }

  if (/\b(q|question)\s*\d+/i.test(q)) {
    const asked = q.match(/\b(?:q|question)\s*(\d+)/i)?.[1];
    if (asked) {
      const re = new RegExp(`(?:^|\\n|\\s)${asked}\\.\\s*([\\s\\S]{80,1400}?)(?=\\n\\s*${Number(asked) + 1}\\.|\\n\\s*\\(${Number(asked) + 1}\\)|$)`, "i");
      const found = context.match(re);
      if (found) return `Q${asked}: ${found[1].trim()}\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
    }
  }

  const best = chunks
    .slice(0, 3)
    .map((c) => `From ${c.document_name} Chunk #${c.chunk_index}:\n${c.content.slice(0, 900).trim()}`)
    .join("\n\n---\n\n");
  return `${best}\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
}

async function saveAssistantResponse(stream: ReadableStream<Uint8Array>, supabase: any, sessionId: string, userId: string) {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
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
    if (full.trim()) await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: full, user_id: userId });
  } catch (error) {
    console.error("history save failed:", error);
  }
}

const PROMPT_DS = `You are a senior Data Science & ML Engineering assistant. Provide complete, runnable code with concise explanations.`;
const PROMPT_RES = `You are an autonomous research agent. Break down questions into sub-tasks and provide structured reports with citations.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_KEY) throw new Error("LOVABLE_API_KEY missing");

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
    const { messages, mode, sessionId } = await req.json();
    const safeMessages: Message[] = Array.isArray(messages) ? messages : [];
    const userQuery = String(safeMessages[safeMessages.length - 1]?.content || "").trim();

    // Build a context-aware retrieval query: short follow-ups ("and in hindi language mai 4 point",
    // "iska hindi mai", "next point", "aur batao") must inherit the previous user turn(s) so
    // semantic search doesn't lose the topic ("admit card", "point 3", etc.).
    const previousUserTurns = safeMessages
      .slice(0, -1)
      .filter((m) => m.role === "user")
      .slice(-2)
      .map((m) => String(m.content || "").trim())
      .filter(Boolean);
    const wordCount = userQuery.split(/\s+/).filter(Boolean).length;
    const looksLikeFollowup =
      wordCount <= 10 ||
      /\b(iska|isme|isko|isi|usi|wahi|same|next|previous|pichla|agla|aur|and|hindi|english|translate|anuvad|point|line|paragraph|detail|explain|expand|summarise|summary|short|long)\b/i.test(
        userQuery,
      );
    const retrievalQuery =
      looksLikeFollowup && previousUserTurns.length > 0
        ? `${previousUserTurns.join(" \n ")} \n ${userQuery}`
        : userQuery;

    if (sessionId && userQuery) {
      await supabase.from("chat_history").insert({ session_id: sessionId, role: "user", message: userQuery, user_id: userId });
    }

    const aiMessages: Message[] = [
      { role: "system", content: mode === "datascience" ? PROMPT_DS : mode === "research" ? PROMPT_RES : strictPrompt() },
    ];

    if (mode === "documents" && userQuery) {
      const variants = Array.from(
        new Set([...buildVariants(retrievalQuery), ...buildVariants(userQuery)]),
      );
      const seen = new Map<string, RetrievedChunk>();

      // Batch all query variants into one embedding call to reduce rate limits and latency.
      const variantEmbeddings = await embedMany(variants);
      const variantResults = await Promise.all(
        variants.map(async (_variant, idx) => {
          const embedding = variantEmbeddings[idx];
          if (!embedding) return [] as RetrievedChunk[];
          const { data, error } = await supabase.rpc("match_document_chunks", {
            query_embedding: JSON.stringify(embedding) as any,
            filter_user_id: userId,
            match_threshold: 0.0,
            match_count: 40,
          });
          if (error) {
            console.error("match_document_chunks failed:", error.message);
            return [] as RetrievedChunk[];
          }
          return (data || []) as RetrievedChunk[];
        }),
      );
      for (const list of variantResults) {
        for (const raw of list) {
          const kScore = keywordScore(userQuery, raw.content);
          const hybridScore = (raw.similarity || 0) * 0.7 + kScore * 0.3;
          const chunk = { ...raw, keywordScore: kScore, hybridScore };
          const prev = seen.get(chunk.id);
          if (!prev || (chunk.hybridScore || 0) > (prev.hybridScore || 0)) seen.set(chunk.id, chunk);
        }
      }

      // Add literal field-match candidates so identity queries like "admit card kis person ka hai"
      // can still find chunks containing "Name / Roll No / Enrollment" even when those exact words are absent.
      const keywordResults = await keywordFallbackSearch(supabase, userQuery, userId);
      for (const raw of keywordResults) {
        const prev = seen.get(raw.id);
        if (!prev || (raw.hybridScore || 0) > (prev.hybridScore || 0)) seen.set(raw.id, raw);
      }
      // Also run keyword fallback on the contextualised query so follow-ups still pull the topic chunks.
      if (retrievalQuery !== userQuery) {
        const ctxResults = await keywordFallbackSearch(supabase, retrievalQuery, userId);
        for (const raw of ctxResults) {
          const prev = seen.get(raw.id);
          if (!prev || (raw.hybridScore || 0) > (prev.hybridScore || 0)) seen.set(raw.id, raw);
        }
      }

      // Re-weight: when numeric tokens present, keyword match matters more than semantic
      const qNumTokens = keywords(userQuery).filter((w) => /\d/.test(w));
      const semanticWeight = qNumTokens.length > 0 ? 0.35 : 0.6;
      const keywordWeight = 1 - semanticWeight;
      for (const c of seen.values()) {
        c.hybridScore = (c.similarity || 0) * semanticWeight + (c.keywordScore || 0) * keywordWeight;
      }
      const chunks = Array.from(seen.values())
        .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))
        .slice(0, 25);

      // Wide-intent (about / biography / list-all) → much larger neighbor radius so full sections come through
      const ql = userQuery.toLowerCase();
      const isWideIntent = /\b(about|biography|biograph|overview|introduction|intro|who is|kaun|bare|baare|complete|full|all|list|history|career|life)\b/i.test(ql);
      const radius = isWideIntent ? 6 : 1;
      const topN = isWideIntent ? 3 : 5;
      const top = chunks.slice(0, topN);
      const neighborKeys = new Set<string>();
      for (const c of top) {
        for (let off = -radius; off <= radius; off++) {
          if (off === 0) continue;
          neighborKeys.add(`${c.document_id}:${c.chunk_index + off}`);
        }
      }
      const haveKeys = new Set(chunks.map((c) => `${c.document_id}:${c.chunk_index}`));
      const missing = Array.from(neighborKeys).filter((k) => !haveKeys.has(k));
      if (missing.length > 0) {
        const orFilter = missing
          .map((k) => {
            const [doc, idx] = k.split(":");
            return `and(document_id.eq.${doc},chunk_index.eq.${idx})`;
          })
          .join(",");
        const { data: neigh } = await supabase
          .from("document_chunks")
          .select("id,document_id,document_name,content,chunk_index,page_num")
          .eq("user_id", userId)
          .or(orFilter);
        for (const n of (neigh || []) as any[]) {
          chunks.push({ ...n, similarity: 0, keywordScore: 0, hybridScore: 0 });
        }
        // Re-sort: keep top-scored first, then neighbors interleaved by chunk_index per doc
        chunks.sort((a, b) => {
          if (a.document_id === b.document_id) return a.chunk_index - b.chunk_index;
          return (b.hybridScore || 0) - (a.hybridScore || 0);
        });
      }

      console.log(
        JSON.stringify({ event: "retrieval", query: userQuery, retrievalQuery, variants, chunks: chunks.length }),
      );

      if (chunks.length > 0) {
        aiMessages.push({
          role: "system",
          content: `[Context]\n${buildContext(chunks)}\n\n[Conversation so far]\n${previousUserTurns
            .map((q, i) => `User${i + 1}: ${q}`)
            .join("\n")}\n\n[Current User Question]\n${userQuery}\n\n[Instruction]\nThe current question may be a short follow-up — resolve any pronouns/ellipsis using the conversation so far (e.g. "4th point in hindi" means translate the 4th instruction of the same document discussed earlier). Answer using ONLY the context above. If asked to translate or rephrase a specific point/line/paragraph from the document, locate it precisely in the context and produce it. If truly absent, say "I could not find a relevant answer in the provided documents." End with 📌 citations.`,
        });
      } else {
        aiMessages.push({
          role: "system",
          content: "No relevant chunks retrieved. Reply exactly: I could not find a relevant answer in the provided documents.",
        });
      }
    }

    aiMessages.push(...safeMessages);

    const response = await gatewayFetch("/chat/completions", {
      model: "google/gemini-2.5-flash-lite",
      messages: aiMessages,
      stream: true,
      temperature: 0,
      max_tokens: 3072,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      if (mode === "documents") {
        const contextMessage = aiMessages.find((m) => m.role === "system" && m.content.startsWith("[Context]"));
        if (contextMessage) {
          const fallbackChunks = Array.from((contextMessage.content.matchAll(/\[Chunk #(\d+) \| File: ([^|]+) \|[^\]]+\]\n([\s\S]*?)(?=\n\n---\n\n\[Chunk #|\n\n\[Conversation so far\]|$)/g)))
            .slice(0, 8)
            .map((m, i) => ({
              id: `fallback-${i}`,
              document_id: "",
              document_name: m[2].trim(),
              chunk_index: Number(m[1]),
              content: m[3].trim(),
              similarity: 0,
            } as RetrievedChunk));
          const fallbackText = deterministicFallback(userQuery, fallbackChunks);
          if (sessionId) await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: fallbackText, user_id: userId });
          return sseTextResponse(fallbackText);
        }
      }
      const message =
        response.status === 429
          ? "Rate limits exceeded, please try again later."
          : response.status === 402
            ? "Lovable AI credits exhausted. Please add credits in Workspace Usage."
            : "AI response failed.";
      return new Response(JSON.stringify({ error: message }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!response.body) throw new Error("AI response stream missing");
    const [clientStream, historyStream] = response.body.tee();
    if (sessionId) saveAssistantResponse(historyStream, supabase, sessionId, userId);

    return new Response(clientStream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (error) {
    console.error("agent-chat:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
