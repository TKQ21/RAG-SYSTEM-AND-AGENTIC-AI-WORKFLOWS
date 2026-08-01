import { supabase } from "@/integrations/supabase/client";

export type IngestKind = "website" | "docs" | "github" | "rest";

export interface SourceDefinition {
  id: string;
  label: string;
  kind: IngestKind | "credentials";
  ingestKind?: IngestKind;
  placeholder?: string;
  hint: string;
  /** Providers that need OAuth/DB credentials before ingestion can run. */
  requires?: string;
}

export const SOURCE_DEFINITIONS: SourceDefinition[] = [
  { id: "website", label: "Company Website", kind: "website", ingestKind: "website", placeholder: "https://company.com", hint: "Same-origin crawl, pages become citable page numbers." },
  { id: "docs", label: "Documentation Portal", kind: "docs", ingestKind: "docs", placeholder: "https://docs.example.com", hint: "Crawls a docs site section by section." },
  { id: "github", label: "GitHub Documentation", kind: "github", ingestKind: "github", placeholder: "https://github.com/owner/repo", hint: "Reads all .md / .mdx / .txt / .rst files from the default branch." },
  { id: "rest", label: "REST API", kind: "rest", ingestKind: "rest", placeholder: "https://api.example.com/v1/articles", hint: "JSON arrays are indexed row-wise for exact counting and filtering." },
  { id: "kb", label: "Internal Knowledge Base", kind: "rest", ingestKind: "rest", placeholder: "https://kb.internal/api/export", hint: "Any JSON/HTML export endpoint works. Add an auth header if needed." },
  { id: "papers", label: "Research Papers", kind: "website", ingestKind: "website", placeholder: "https://arxiv.org/abs/2401.00001", hint: "Public paper/abstract pages are crawled and cited by page." },
  { id: "notion", label: "Notion", kind: "credentials", hint: "Per-user Notion access needs an OAuth connector.", requires: "Notion OAuth connector" },
  { id: "gdrive", label: "Google Drive", kind: "credentials", hint: "Needs a Google OAuth client with Drive scopes.", requires: "Google OAuth client" },
  { id: "sharepoint", label: "SharePoint", kind: "credentials", hint: "Needs a Microsoft Entra app registration.", requires: "Microsoft Entra app" },
  { id: "confluence", label: "Confluence", kind: "credentials", hint: "Needs an Atlassian API token + site URL.", requires: "Atlassian API token" },
  { id: "postgres", label: "PostgreSQL", kind: "credentials", hint: "Needs a read-only connection string stored as a secret.", requires: "Postgres connection string" },
  { id: "mysql", label: "MySQL", kind: "credentials", hint: "Needs a read-only connection string stored as a secret.", requires: "MySQL connection string" },
];

const INGEST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-source`;
const PROCESS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-document`;

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return `Bearer ${token}`;
}

export interface IngestOptions {
  sourceType: IngestKind;
  url: string;
  maxPages?: number;
  apiKeyHeader?: string;
  apiKeyValue?: string;
  /** Re-index: replaces chunks of a previously indexed copy of the same source. */
  reindex?: boolean;
}

export interface IngestResult {
  documentId: string;
  documentName: string;
  chunkCount: number;
  pageCount: number;
}

/** Fetch an external source, then run it through the same chunk + embed pipeline as uploads. */
export async function ingestExternalSource(options: IngestOptions): Promise<IngestResult> {
  const header = await authHeader();

  const fetchRes = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: header },
    body: JSON.stringify({
      sourceType: options.sourceType,
      url: options.url,
      maxPages: options.maxPages ?? 12,
      apiKeyHeader: options.apiKeyHeader,
      apiKeyValue: options.apiKeyValue,
    }),
  });
  const fetched = await fetchRes.json();
  if (!fetchRes.ok) throw new Error(fetched.error || "Source fetch failed");

  const documentName = `${fetched.sourceName}`;

  // Incremental re-index: drop the previous version of this source before storing the new one.
  if (options.reindex) {
    const { data: existing } = await supabase
      .from("documents")
      .select("id")
      .eq("name", documentName);
    for (const row of existing || []) {
      await supabase.from("document_chunks").delete().eq("document_id", row.id);
      await supabase.from("documents").delete().eq("id", row.id);
    }
  }

  const processRes = await fetch(PROCESS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: header },
    body: JSON.stringify({
      documentName,
      documentText: fetched.text,
      mimeType: "text/markdown",
      fileSize: fetched.charCount,
      pageCount: fetched.pageCount,
    }),
  });
  const processed = await processRes.json();
  if (!processRes.ok) throw new Error(processed.error || "Indexing failed");

  return {
    documentId: processed.documentId,
    documentName: processed.documentName,
    chunkCount: processed.chunkCount,
    pageCount: fetched.pageCount,
  };
}