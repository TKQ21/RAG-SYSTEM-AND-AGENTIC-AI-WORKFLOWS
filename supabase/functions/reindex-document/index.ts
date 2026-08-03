import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gatewayFetch(path: string, body: unknown, attempts = 3): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(`${GATEWAY}${path}`, {
      method: "POST",
      headers: { "Lovable-API-Key": LOVABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) return res;
    last = res;
    await wait(900 * (attempt + 1));
  }
  return last!;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await gatewayFetch("/embeddings", {
    model: "openai/text-embedding-3-small",
    input: texts,
    dimensions: 768,
  });
  if (!res.ok) throw new Error(`embed failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const ordered = [...(json.data || [])].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = ordered.map((item: any) => item.embedding as number[]);
  if (vectors.length !== texts.length) throw new Error(`embedding batch mismatch ${vectors.length}/${texts.length}`);
  return vectors;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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

    const { documentId } = await req.json();
    if (!documentId || typeof documentId !== "string") {
      return new Response(JSON.stringify({ error: "documentId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("id, name, user_id, space_id")
      .eq("id", documentId)
      .maybeSingle();
    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Permission: owner, or a space editor/admin when the doc lives in a knowledge space.
    let allowed = doc.user_id === userId;
    if (!allowed && doc.space_id) {
      const { data: canWrite } = await supabase.rpc("can_write_space", {
        _space_id: doc.space_id,
        _user_id: userId,
      });
      allowed = canWrite === true;
    }
    if (!allowed) {
      return new Response(JSON.stringify({ error: "You do not have permission to re-index this document" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: chunks, error: chunkErr } = await supabase
      .from("document_chunks")
      .select("id, content")
      .eq("document_id", documentId)
      .order("chunk_index", { ascending: true });
    if (chunkErr) throw chunkErr;
    if (!chunks || chunks.length === 0) {
      return new Response(
        JSON.stringify({ error: "No stored chunks to re-index. Please re-upload this document." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await supabase.from("documents").update({ status: "indexing" }).eq("id", documentId);

    const BATCH = 32;
    let reindexed = 0;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      let vectors: number[][];
      try {
        vectors = await embedBatch(slice.map((c: any) => String(c.content || "").slice(0, 6000)));
      } catch (e) {
        console.error("reindex embed batch failed", i, e);
        continue;
      }
      for (let j = 0; j < slice.length; j += 1) {
        const { error } = await supabase
          .from("document_chunks")
          .update({ embedding: JSON.stringify(vectors[j]) })
          .eq("id", (slice[j] as any).id);
        if (error) console.error("reindex update failed", error.message);
        else reindexed += 1;
      }
    }

    await supabase
      .from("documents")
      .update({ status: reindexed > 0 ? "ready" : "error", chunk_count: chunks.length })
      .eq("id", documentId);

    return new Response(JSON.stringify({ success: true, documentId, reindexed, total: chunks.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("reindex-document:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});