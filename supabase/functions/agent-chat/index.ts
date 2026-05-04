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

function embed(text: string): number[] {
  const vec = new Array(384).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 384] += text.charCodeAt(i) / 1000;
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / mag);
}

function normalizeQuery(q: string): string {
  return String(q || "")
    .toLowerCase()
    .replace(/\b(ka|ki|ke|mai|mein|me|kya|hai|toh|aur|se|ko|kitni|kitna|batao|please|yr|yaar)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywords(text: string): string[] {
  return normalizeQuery(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(the|and|for|with|from|this|that|what|which|how|who|pdf|document)$/.test(w));
}

function keywordScore(question: string, content: string): number {
  const qWords = keywords(question);
  if (qWords.length === 0) return 0;
  const haystack = ` ${content.toLowerCase()} `;
  let score = 0;
  for (const word of qWords) {
    if (haystack.includes(word)) score += 1;
  }
  return Math.min(1, score / qWords.length);
}

function buildVariants(question: string): string[] {
  const norm = normalizeQuery(question);
  return Array.from(new Set([question, norm, keywords(question).join(" ")].filter((s) => s && s.length > 1)));
}

function strictPrompt(): string {
  return `You are a strict NotebookLM-style document intelligence assistant.

CRITICAL RULES:
1. Answer ONLY from [Context]. Never use outside knowledge.
2. Understand the user's semantic intent in English/Hindi/Hinglish, then map it to the relevant context chunks.
3. If the answer is not in the context, say exactly: "I could not find a relevant answer in the provided documents."
4. If multiple values exist, list ALL of them with exact labels.
5. Read tables row-by-row and preserve labels and numbers exactly.
6. Keep answers concise: 2-4 sentences unless listing items.
7. Match student NAME, Roll No, and Enrollment No interchangeably (e.g., "MOHD KAIF" and "25345201387" refer to the same student). Report all subjects, grades, SGPA, and result status found.
8. End every answer with citations, max 3, one per line:
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
    .slice(0, 18000);
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
    if (full.trim()) await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: full });
  } catch (error) {
    console.error("history save failed:", error);
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

    const aiMessages: Message[] = [
      { role: "system", content: mode === "datascience" ? PROMPT_DS : mode === "research" ? PROMPT_RES : strictPrompt() },
    ];

    if (mode === "documents" && userQuery) {
      const variants = buildVariants(userQuery);
      const seen = new Map<string, RetrievedChunk>();

      for (const variant of variants) {
        const embedding = embed(variant);
        const { data, error } = await supabase.rpc("match_document_chunks", {
          query_embedding: JSON.stringify(embedding) as any,
          match_threshold: 0.1,
          match_count: 30,
        });
        if (error) {
          console.error("match_document_chunks failed:", error.message);
          continue;
        }
        for (const raw of (data || []) as RetrievedChunk[]) {
          const kScore = keywordScore(userQuery, raw.content);
          const hybridScore = (raw.similarity || 0) * 0.4 + kScore * 0.6;
          const chunk = { ...raw, keywordScore: kScore, hybridScore };
          const prev = seen.get(chunk.id);
          if (!prev || (chunk.hybridScore || 0) > (prev.hybridScore || 0)) seen.set(chunk.id, chunk);
        }
      }

      const chunks = Array.from(seen.values())
        .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))
        .slice(0, 12);

      console.log(JSON.stringify({ event: "retrieval", query: userQuery, variants, chunks: chunks.length }));

      if (chunks.length > 0) {
        aiMessages.push({
          role: "system",
          content: `[Context]\n${buildContext(chunks)}\n\n[User Question]\n${userQuery}\n\n[Instruction]\nAnswer using only the context. If the answer is not present, say "I could not find a relevant answer in the provided documents." End with 📌 citations.`,
        });
      } else {
        aiMessages.push({
          role: "system",
          content: "No relevant chunks retrieved. Reply exactly: I could not find a relevant answer in the provided documents.",
        });
      }
    }

    aiMessages.push(...safeMessages);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: aiMessages, stream: true, temperature: 0 }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
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
