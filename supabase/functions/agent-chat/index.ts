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

      // Use RPC for vector similarity search - pgvector expects "[0.1,0.2,...]" format
      const embeddingStr = `[${queryEmbedding.join(",")}]`;
      const { data: matchedChunks, error: rpcError } = await supabase.rpc(
        "match_document_chunks",
        {
          query_embedding: embeddingStr,
          match_threshold: 0.05,
          match_count: 15,
        }
      );

      if (rpcError) {
        console.error("RPC match error:", JSON.stringify(rpcError));
        // Fallback: fetch all chunks and rank in JS
        const { data: allChunks } = await supabase
          .from("document_chunks")
          .select("id, document_name, chunk_index, content, embedding")
          .limit(500);

        if (allChunks && allChunks.length > 0) {
          const ranked = allChunks
            .map((c: any) => {
              let sim = 0;
              if (c.embedding) {
                let emb: number[];
                try {
                  emb = typeof c.embedding === "string" ? JSON.parse(c.embedding) : c.embedding;
                } catch { emb = []; }
                if (emb.length === queryEmbedding.length) {
                  let dot = 0, magA = 0, magB = 0;
                  for (let i = 0; i < emb.length; i++) {
                    dot += emb[i] * queryEmbedding[i];
                    magA += emb[i] * emb[i];
                    magB += queryEmbedding[i] * queryEmbedding[i];
                  }
                  const denom = Math.sqrt(magA) * Math.sqrt(magB);
                  sim = denom > 0 ? dot / denom : 0;
                }
              }
              return { ...c, similarity: sim, embedding: undefined };
            })
            .sort((a: any, b: any) => b.similarity - a.similarity)
            .slice(0, 15);

          const contextText = ranked
            .map((c: any) => `[Source: ${c.document_name}, Chunk #${c.chunk_index}, Relevance: ${(c.similarity * 100).toFixed(1)}%]\n${c.content}`)
            .join("\n\n---\n\n");

          aiMessages.push({
            role: "system",
            content: `Retrieved document chunks:\n\n${contextText}\n\nAnswer ONLY from these chunks. Cite the source document.`,
          });
          console.log(`Fallback: ${ranked.length} chunks, top sim: ${ranked[0]?.similarity?.toFixed(3)}`);
        }
      } else if (matchedChunks && matchedChunks.length > 0) {
        const contextText = matchedChunks
          .map((c: any) => `[Source: ${c.document_name}, Chunk #${c.chunk_index}, Relevance: ${(c.similarity * 100).toFixed(1)}%]\n${c.content}`)
          .join("\n\n---\n\n");

        aiMessages.push({
          role: "system",
          content: `Retrieved document chunks via semantic search:\n\n${contextText}\n\nAnswer ONLY from these chunks. Cite the source document.`,
        });
        console.log(`RPC: ${matchedChunks.length} chunks, top sim: ${matchedChunks[0]?.similarity?.toFixed(3)}`);
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
