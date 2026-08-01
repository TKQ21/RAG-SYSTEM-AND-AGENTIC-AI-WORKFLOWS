import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_CHARS = 900_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pageTitle(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (m?.[1] || fallback).replace(/\s+/g, " ").trim().slice(0, 120);
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function extractLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], base).toString().split("#")[0];
      if (!/^https?:/i.test(abs)) continue;
      if (!sameOrigin(abs, base)) continue;
      if (/\.(png|jpe?g|gif|svg|webp|css|js|zip|pdf|ico|woff2?)$/i.test(abs)) continue;
      out.add(abs);
    } catch { /* ignore malformed href */ }
  }
  return [...out];
}

async function fetchText(url: string): Promise<{ html: string; ok: boolean; status: number }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "NexusRAG-Ingest/1.0", Accept: "text/html,application/xhtml+xml,text/plain,*/*" },
  });
  const html = await res.text();
  return { html, ok: res.ok, status: res.status };
}

/** Crawl a website (same-origin, breadth-first) into one page-labelled text document. */
async function ingestWebsite(startUrl: string, maxPages: number) {
  const queue = [startUrl];
  const visited = new Set<string>();
  const parts: string[] = [];
  let pageNumber = 0;

  while (queue.length && pageNumber < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    let fetched;
    try {
      fetched = await fetchText(url);
    } catch (e) {
      console.error("fetch failed", url, e);
      continue;
    }
    if (!fetched.ok) continue;

    const text = htmlToText(fetched.html);
    if (text.length < 80) continue;

    pageNumber += 1;
    parts.push(`[Page ${pageNumber}]\n# ${pageTitle(fetched.html, url)}\nURL: ${url}\n\n${text}`);

    if (pageNumber < maxPages) {
      for (const link of extractLinks(fetched.html, startUrl)) {
        if (!visited.has(link) && queue.length + pageNumber < maxPages * 3) queue.push(link);
      }
    }
  }

  if (!parts.length) throw new Error("No readable text found at that URL.");
  return {
    name: `web · ${new URL(startUrl).hostname}`,
    text: parts.join("\n\n").slice(0, MAX_CHARS),
    pageCount: pageNumber,
  };
}

/** Ingest documentation files (.md/.mdx/.txt/.rst) from a public GitHub repository. */
async function ingestGithub(repoUrl: string, maxFiles: number) {
  const m = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) throw new Error("Expected a GitHub repository URL like https://github.com/owner/repo");
  const owner = m[1];
  const repo = m[2].replace(/\.git$/, "");

  const headers: Record<string, string> = {
    "User-Agent": "NexusRAG-Ingest/1.0",
    Accept: "application/vnd.github+json",
  };
  const token = Deno.env.get("GITHUB_TOKEN");
  if (token) headers.Authorization = `Bearer ${token}`;

  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) throw new Error(`GitHub repo lookup failed (${repoRes.status}). Public repos only.`);
  const repoInfo = await repoRes.json();
  const branch = repoInfo.default_branch || "main";

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers },
  );
  if (!treeRes.ok) throw new Error(`GitHub tree fetch failed (${treeRes.status}).`);
  const tree = await treeRes.json();

  const docFiles = (tree.tree || [])
    .filter((n: any) => n.type === "blob" && /\.(md|mdx|txt|rst)$/i.test(n.path))
    .slice(0, maxFiles);
  if (!docFiles.length) throw new Error("No markdown/text documentation files found in this repository.");

  const parts: string[] = [];
  let pageNumber = 0;
  for (const file of docFiles) {
    const raw = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`,
      { headers: { "User-Agent": "NexusRAG-Ingest/1.0" } },
    );
    if (!raw.ok) continue;
    const content = (await raw.text()).replace(/\r\n?/g, "\n").trim();
    if (content.length < 40) continue;
    pageNumber += 1;
    parts.push(`[Page ${pageNumber}]\n# ${file.path}\n\n${content}`);
  }

  if (!parts.length) throw new Error("Documentation files could not be downloaded.");
  return {
    name: `github · ${owner}/${repo}`,
    text: parts.join("\n\n").slice(0, MAX_CHARS),
    pageCount: pageNumber,
  };
}

function flattenJson(value: unknown, prefix = "", out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, i) => flattenJson(item, `${prefix}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenJson(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.push(`${prefix}: ${String(value)}`);
  }
  return out;
}

/** Ingest a REST API / internal knowledge-base endpoint returning JSON or text. */
async function ingestRest(url: string, apiKeyHeader?: string, apiKeyValue?: string) {
  const headers: Record<string, string> = { Accept: "application/json, text/plain, */*" };
  if (apiKeyHeader && apiKeyValue) headers[apiKeyHeader] = apiKeyValue;

  const res = await fetch(url, { headers });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`Endpoint returned ${res.status}: ${bodyText.slice(0, 200)}`);

  let text: string;
  try {
    const parsed = JSON.parse(bodyText);
    const rows = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.items ?? parsed.results ?? parsed);
    if (Array.isArray(rows)) {
      text = rows
        .slice(0, 5000)
        .map((row, i) => `Row ${i + 1}: ${flattenJson(row).join(" | ")}`)
        .join("\n");
      text = `# REST source\nURL: ${url}\nTotal records: ${Math.min(rows.length, 5000)}\n\n## Rows (structured)\n${text}`;
    } else {
      text = `# REST source\nURL: ${url}\n\n${flattenJson(parsed).join("\n")}`;
    }
  } catch {
    text = `# REST source\nURL: ${url}\n\n${htmlToText(bodyText)}`;
  }

  return { name: `api · ${new URL(url).hostname}`, text: text.slice(0, MAX_CHARS), pageCount: 1 };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const payload = await req.json();
    const sourceType = String(payload?.sourceType || "");
    const url = String(payload?.url || "").trim();
    const maxPages = Math.min(Math.max(Number(payload?.maxPages) || 12, 1), 60);

    if (!/^https?:\/\//i.test(url)) return json({ error: "A valid http(s) URL is required" }, 400);

    let result: { name: string; text: string; pageCount: number };
    if (sourceType === "website" || sourceType === "docs") {
      result = await ingestWebsite(url, maxPages);
    } else if (sourceType === "github") {
      result = await ingestGithub(url, maxPages);
    } else if (sourceType === "rest") {
      result = await ingestRest(url, payload?.apiKeyHeader, payload?.apiKeyValue);
    } else {
      return json({ error: `Unsupported source type: ${sourceType}` }, 400);
    }

    if (result.text.length < 40) return json({ error: "Source returned no usable text" }, 400);

    return json({
      success: true,
      sourceName: result.name,
      text: result.text,
      pageCount: result.pageCount,
      charCount: result.text.length,
    });
  } catch (error) {
    console.error("ingest-source:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});