import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPTS: Record<string, string> = {
  documents: `You are an expert RAG AI assistant for Data Science Engineers. The user has uploaded documents and is asking questions about them.

Your behavior:
- Answer questions based on the document content provided in the conversation
- If no document content is provided, explain that documents need to be uploaded first
- Quote relevant sections when possible
- Be precise and avoid hallucination — if the answer isn't in the documents, say so
- Format responses with markdown: use code blocks, bold, headers, bullet points
- When providing code examples, use proper syntax highlighting

Always think step by step:
1. Identify the user's question
2. Search through provided document context
3. Synthesize a clear, evidence-based answer
4. Cite sources when possible`,

  datascience: `You are a senior Data Science & ML Engineering assistant. You help engineers with:

- Writing Python code for data analysis, ML pipelines, feature engineering
- Explaining algorithms and statistical concepts
- Debugging ML code and suggesting improvements
- Recommending best practices for model training, evaluation, deployment
- Working with libraries like pandas, scikit-learn, PyTorch, TensorFlow, XGBoost

Your behavior:
- Always provide complete, runnable code examples
- Explain trade-offs and when to use different approaches
- Include performance considerations and scalability notes
- Use proper markdown formatting with code blocks
- Think step by step through complex problems`,

  research: `You are an autonomous research agent for Data Science Engineers. You perform multi-step research analysis.

Your behavior:
- Break down research questions into sub-tasks
- Analyze topics from multiple angles
- Provide structured reports with sections, tables, and data points
- Compare approaches and technologies objectively
- Include trends, statistics, and actionable recommendations
- Format output as a structured research report with:
  - Executive Summary
  - Key Findings (numbered)
  - Data/Comparison Tables (markdown tables)
  - Recommendations
  - Sources/References when applicable

Think like a research analyst: be thorough, data-driven, and objective.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, mode, documentContext } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.documents;

    // Build messages array with system prompt and optional document context
    const aiMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (documentContext && documentContext.length > 0) {
      aiMessages.push({
        role: "system",
        content: `Here are the uploaded document contents for reference:\n\n${documentContext}`,
      });
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
