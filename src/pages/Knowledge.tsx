import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Globe, Github, Server, Lock, Loader2, RefreshCw, Plug } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { SOURCE_DEFINITIONS, ingestExternalSource, type SourceDefinition } from "@/lib/knowledgeSources";
import { VectorStoreSettings } from "@/components/VectorStoreSettings";

function iconFor(source: SourceDefinition) {
  if (source.kind === "credentials") return Lock;
  if (source.id === "github") return Github;
  if (source.kind === "rest") return Server;
  return Globe;
}

export default function Knowledge() {
  const { user, loading } = useAuth();
  const [active, setActive] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(12);
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [reindex, setReindex] = useState(true);
  const [log, setLog] = useState<string[]>([]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-pink border-t-transparent" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  const selected = SOURCE_DEFINITIONS.find((s) => s.id === active) || null;

  const runIngest = async () => {
    if (!selected?.ingestKind) return;
    if (!/^https?:\/\//i.test(url.trim())) {
      toast.error("Enter a full http(s) URL");
      return;
    }
    setBusy(true);
    try {
      const result = await ingestExternalSource({
        sourceType: selected.ingestKind,
        url: url.trim(),
        maxPages,
        apiKeyHeader: headerName.trim() || undefined,
        apiKeyValue: headerValue.trim() || undefined,
        replaceExistingName: reindex ? undefined : undefined,
      });
      setLog((prev) => [
        `${result.documentName} — ${result.chunkCount} chunks from ${result.pageCount} page(s)`,
        ...prev,
      ]);
      toast.success(`Indexed ${result.chunkCount} chunks from ${result.documentName}`);
      setUrl("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ingestion failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center gap-3">
          <Link
            to="/"
            className="rounded-lg border border-neon-pink/30 p-2 text-neon-pink/80 transition-all hover:bg-neon-pink/10 hover:text-neon-pink"
            aria-label="Back to chat"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-black uppercase tracking-wider text-foreground">Enterprise Knowledge Sources</h1>
            <p className="font-mono text-[11px] text-muted-foreground">
              Ingest external knowledge · hybrid semantic search · page-level citations
            </p>
          </div>
        </header>

        <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SOURCE_DEFINITIONS.map((source) => {
            const Icon = iconFor(source);
            const isActive = active === source.id;
            const locked = source.kind === "credentials";
            return (
              <button
                key={source.id}
                onClick={() => {
                  setActive(source.id);
                  if (locked) {
                    toast.info(`${source.label} needs ${source.requires}. Ask me in chat to set it up and I'll wire the connector.`);
                  }
                }}
                className={`rounded-xl border p-3 text-left transition-all ${
                  isActive
                    ? "border-neon-pink/60 bg-neon-pink/10 shadow-[0_0_18px_hsl(330_100%_62%/0.25)]"
                    : "border-border bg-secondary/30 hover:border-neon-pink/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${locked ? "text-muted-foreground" : "text-neon-pink"}`} />
                  <span className="text-xs font-semibold text-foreground">{source.label}</span>
                  {locked && (
                    <span className="ml-auto rounded border border-neon-yellow/30 px-1.5 py-0.5 font-mono text-[9px] text-neon-yellow/80">
                      SETUP
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{source.hint}</div>
              </button>
            );
          })}
        </section>

        {selected?.ingestKind && (
          <section className="space-y-3 rounded-2xl border border-neon-pink/25 bg-card/60 p-4">
            <div className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-neon-pink" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-neon-pink">{selected.label}</h2>
            </div>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={selected.placeholder}
              className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground outline-none focus:border-neon-pink/60"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                Max pages / files
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={maxPages}
                  onChange={(e) => setMaxPages(Number(e.target.value))}
                  className="w-20 rounded border border-border bg-secondary/50 px-2 py-1 text-xs text-foreground outline-none focus:border-neon-pink/60"
                />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={reindex} onChange={(e) => setReindex(e.target.checked)} />
                Re-index (replace previous copy of this source)
              </label>
            </div>
            {selected.kind === "rest" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={headerName}
                  onChange={(e) => setHeaderName(e.target.value)}
                  placeholder="Auth header name (optional)"
                  className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-foreground outline-none focus:border-neon-pink/60"
                />
                <input
                  value={headerValue}
                  onChange={(e) => setHeaderValue(e.target.value)}
                  placeholder="Auth header value (optional)"
                  className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-foreground outline-none focus:border-neon-pink/60"
                />
              </div>
            )}
            <button
              onClick={runIngest}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg border border-neon-pink/50 bg-neon-pink/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-neon-pink transition-all hover:bg-neon-pink/20 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {busy ? "Ingesting & embedding…" : "Ingest & index"}
            </button>
            <p className="text-[11px] text-muted-foreground">
              {selected.hint} Indexed content appears as a document in chat, with page numbers used for citations.
            </p>
          </section>
        )}

        {selected?.kind === "credentials" && (
          <section className="rounded-2xl border border-neon-yellow/30 bg-neon-yellow/5 p-4 text-xs text-foreground/85">
            <strong className="text-neon-yellow">{selected.label}</strong> requires {selected.requires}. Ask me in chat to
            connect it — I'll set up the connector and per-user authorization, then it will appear here as an ingestible source.
          </section>
        )}

        {log.length > 0 && (
          <section className="rounded-2xl border border-neon-cyan/25 bg-card/60 p-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-neon-cyan">Recent sync</h2>
            <ul className="space-y-1 font-mono text-[11px] text-muted-foreground">
              {log.map((entry, i) => (
                <li key={i}>● {entry}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-neon-cyan/25 bg-card/60 p-4">
          <VectorStoreSettings />
        </section>
      </div>
    </main>
  );
}