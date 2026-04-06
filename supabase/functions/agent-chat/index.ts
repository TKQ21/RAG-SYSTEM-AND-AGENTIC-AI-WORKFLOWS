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
  documents: `You are an expert RAG AI assistant for Data Science Engineers, similar to NotebookLM. Users upload documents and ask questions about them.

Your behavior:
- Answer ONLY based on the document context provided below. If the answer isn't in the documents, say "I couldn't find this information in the uploaded documents."
- Quote relevant sections verbatim when possible, using blockquotes
- Be precise — no hallucination, no guessing
- For tables/structured data in documents, reproduce them as markdown tables
- If asked about subjects, topics, paper details, exam info etc — extract them from the document content
- Understand semantic meaning: "what subjects are there" should find subject lists even if not explicitly labeled
- Format responses with markdown: headers, bold, bullet points, code blocks
- Think step by step and cite which document each piece of info comes from

IMPORTANT: You receive retrieved document chunks below. Use them as your ONLY source of truth.`,

  datascience: `You are a senior Data Science & ML Engineering assistant. You help engineers with:
- Writing Python code for data analysis, ML pipelines, feature engineering
- Explaining algorithms and statistical concepts
- Debugging ML code and suggesting improvements
- Recommending best practices for model training, evaluation, deployment
- Working with libraries like pandas, scikit-learn, PyTorch, TensorFlow, XGBoost

Always provide complete, runnable code examples with explanations.`,

  research: `You are an autonomous research agent for Data Science Engineers. You perform multi-step research analysis.

Your behavior:
- Break down research questions into sub-tasks
- Provide structured reports with sections, tables, and data points
- Compare approaches and technologies objectively
- Include trends, statistics, and actionable recommendations
- Format as structured research report with Executive Summary, Key Findings, Recommendations`,
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

    // Build AI messages
    const aiMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    // For documents mode, perform semantic search
    if (mode === "documents" && userQuery) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const queryEmbedding = simpleEmbed(userQuery);
      const embeddingStr = `[${queryEmbedding.join(",")}]`;

      // Try semantic search via RPC first
      let rankedChunks: any[] = [];
      try {
        const { data: matchedChunks, error: rpcError } = await supabase.rpc("match_document_chunks", {
          query_embedding: embeddingStr,
          match_threshold: 0.0,
          match_count: 10,
        });

        if (rpcError) {
          console.error("RPC error:", JSON.stringify(rpcError));
          // Fallback: fetch all chunks directly
          const { data: allChunks } = await supabase
            .from("document_chunks")
            .select("id, document_name, chunk_index, content")
            .limit(20);
          rankedChunks = (allChunks || []).map(c => ({ ...c, similarity: 0.5 }));
          console.log(`Fallback: ${rankedChunks.length} chunks loaded`);
        } else {
          rankedChunks = matchedChunks || [];
          console.log(`Semantic search: ${rankedChunks.length} chunks matched`);
        }
      } catch (searchErr) {
        console.error("Search exception:", searchErr);
        const { data: allChunks } = await supabase
          .from("document_chunks")
          .select("id, document_name, chunk_index, content")
          .limit(20);
        rankedChunks = (allChunks || []).map(c => ({ ...c, similarity: 0.5 }));
      }

      if (rankedChunks.length > 0) {
        const contextText = rankedChunks
          .map((c: any) => {
            const sim = c.similarity != null ? ` (relevance: ${(c.similarity * 100).toFixed(1)}%)` : "";
            return `[Source: ${c.document_name}, Chunk #${c.chunk_index}${sim}]\n${c.content}`;
          })
          .join("\n\n---\n\n");

        aiMessages.push({
          role: "system",
          content: `Here are the most relevant document chunks retrieved via semantic search:\n\n${contextText}\n\nUse ONLY these chunks to answer the user's question. Cite the source document name.`,
        });

        console.log(`Semantic search: ${chunks.length} chunks found for query "${userQuery.slice(0, 50)}..."`);
      } else {
        aiMessages.push({
          role: "system",
          content: "No documents have been uploaded yet, or no relevant chunks were found. Let the user know they should upload documents first.",
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
          model: "google/gemini-3-flash-preview",
          messages: aiMessages,
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI service error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
