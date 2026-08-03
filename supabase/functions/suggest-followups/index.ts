import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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

    const { question, answer, mode } = await req.json();
    const q = String(question || "").slice(0, 2000);
    const a = String(answer || "").slice(0, 6000);
    if (!q && !a) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { "Lovable-API-Key": LOVABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content:
              "You generate follow-up questions a user would naturally ask next. Rules: return ONLY a JSON array of 3 short questions (max 9 words each), same language as the user's question (Hinglish stays Hinglish), grounded strictly in the given answer's topic, no numbering, no extra text.",
          },
          {
            role: "user",
            content: `Mode: ${mode || "documents"}\n\n[Question]\n${q}\n\n[Answer]\n${a}\n\nReturn the JSON array only.`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const details = await res.text();
      console.error("suggest-followups gateway error", res.status, details.slice(0, 300));
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await res.json();
    const raw = String(json.choices?.[0]?.message?.content || "");
    let suggestions: string[] = [];
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) suggestions = parsed.map((s) => String(s)).filter(Boolean);
      } catch { /* fall through to line parsing */ }
    }
    if (suggestions.length === 0) {
      suggestions = raw
        .split("\n")
        .map((l) => l.replace(/^[-*\d.\s"']+/, "").replace(/["']+$/, "").trim())
        .filter((l) => l.length > 4);
    }

    return new Response(JSON.stringify({ suggestions: suggestions.slice(0, 3) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("suggest-followups:", error);
    return new Response(JSON.stringify({ suggestions: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});