import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function geminiEmbed(text: string, apiKey: string): Promise<number[]> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text: text.slice(0, 2000) }] },
        taskType: "RETRIEVAL_QUERY",
      }),
    }
  );
  const d = await r.json();
  if (d.error) throw new Error("Embed: " + (d.error.message || JSON.stringify(d.error)));
  return d.embedding.values;
}

const PROMPT_DOCS = `You are a precise document Q&A assistant like NotebookLM.

STRICT RULES:
1. Answer ONLY from [Context] — zero outside knowledge.
2. Understand semantic intent in English/Hindi/Hinglish — meaning matters, not exact words.
3. "rate" = percentage value ONLY. "count" = integer ONLY. NEVER mix.
4. If a specific range is asked (e.g. 41-50), use ONLY that range's data — NEVER substitute.
5. If a named section/person is asked, use ONLY that person/section's chunks.
6. For "list/count all X", scan ALL chunks and list every unique item.
7. Read TABLE chunks row-by-row before deciding.
8. If genuinely not in context, say exactly: "I could not find a relevant answer in the provided documents."
9. Max 4 sentences unless listing items.
10. End every answer with citations:
📌 Source: [filename] | Chunk #[n]
(One line per source, top 3 max.)`;

const PROMPT_DS = `You are a senior Data Science & ML Engineering assistant. Provide complete, runnable code with explanations.`;
const PROMPT_RES = `You are an autonomous research agent. Break down questions into sub-tasks and provide structured reports with citations.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const GEMINI = Deno.env.get("GEMINI_API_KEY");
    const LOVABLE = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE) throw new Error("LOVABLE_API_KEY missing");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { messages, mode, sessionId } = await req.json();
    const userQuery: string = messages[messages.length - 1]?.content || "";

    if (sessionId && userQuery) {
      await supabase.from("chat_history").insert({ session_id: sessionId, role: "user", message: userQuery });
    }

    const systemPrompt = mode === "datascience" ? PROMPT_DS : mode === "research" ? PROMPT_RES : PROMPT_DOCS;
    const aiMessages: Array<{ role: string; content: string }> = [{ role: "system", content: systemPrompt }];

    if (mode === "documents" && userQuery && GEMINI) {
      // Multi-query expansion: 4 semantic variants
      const norm = userQuery
        .replace(/(\d+)\s*[-–]\s*(\d+)/g, "$1 to $2 age group")
        .replace(/\b(ka|ki|ke|mai|mein|kya|hai|toh|aur|se|ko|kaise|kyun|kyu)\b/gi, "")
        .replace(/\s+/g, " ").trim();
      const queries = Array.from(new Set([
        userQuery,
        norm,
        userQuery + " exact value percentage number data",
        norm + " table chart row column",
      ])).filter(Boolean);

      const seen = new Map<string, any>();
      for (const q of queries) {
        try {
          const emb = await geminiEmbed(q, GEMINI);
          const { data, error } = await supabase.rpc("match_document_chunks", {
            query_embedding: JSON.stringify(emb) as any,
            match_threshold: 0.3,
            match_count: 15,
          });
          if (error) { console.error("match rpc:", error.message); continue; }
          for (const c of (data || [])) {
            const ex = seen.get(c.id);
            if (!ex || c.similarity > ex.similarity) seen.set(c.id, c);
          }
        } catch (e) { console.error("query variant fail:", e); }
      }

      const chunks = Array.from(seen.values()).sort((a, b) => b.similarity - a.similarity).slice(0, 15);
      console.log(`Retrieved ${chunks.length} chunks, top sim=${chunks[0]?.similarity?.toFixed(3) ?? "n/a"}`);

      if (chunks.length > 0) {
        const ctx = chunks.map((c) =>
          `[Chunk #${c.chunk_index} | File: ${c.document_name} | sim: ${(c.similarity * 100).toFixed(0)}%]\n${c.content}`
        ).join("\n\n---\n\n").slice(0, 18000);

        aiMessages.push({
          role: "system",
          content: `[Context — Document Excerpts]\n${ctx}\n\n[Question]\n${userQuery}\n\nAnswer using ONLY the context above. Cite at the end as: 📌 Source: [filename] | Chunk #[n]`,
        });
      } else {
        aiMessages.push({ role: "system", content: 'No matching chunks found. Reply exactly: "I could not find a relevant answer in the provided documents."' });
      }
    }

    aiMessages.push(...messages);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-pro", messages: aiMessages, stream: true, temperature: 0 }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway:", response.status, t);
      return new Response(
        JSON.stringify({ error: response.status === 429 ? "Rate limited" : response.status === 402 ? "Credits exhausted" : "AI error" }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [s1, s2] = response.body!.tee();
    if (sessionId) {
      (async () => {
        try {
          const reader = s2.getReader();
          const dec = new TextDecoder();
          let full = "", buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf("\n")) !== -1) {
              let line = buf.slice(0, idx); buf = buf.slice(idx + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (!line.startsWith("data: ")) continue;
              const j = line.slice(6).trim();
              if (j === "[DONE]") break;
              try { const p = JSON.parse(j); const d = p.choices?.[0]?.delta?.content; if (d) full += d; } catch {}
            }
          }
          if (full) await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: full });
        } catch (e) { console.error("save asst:", e); }
      })();
    }

    return new Response(s1, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("agent-chat:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
