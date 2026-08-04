import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  ArrowLeft, Upload, RefreshCw, Trash2, Network, Layers, Loader2,
  Activity, Clock, FileText, Database, Search, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSpaces } from "@/hooks/useSpaces";
import { useAgentChat } from "@/hooks/useAgentChat";
import { supabase } from "@/integrations/supabase/client";
import { domainLabel } from "@/lib/spaces";

const REINDEX_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reindex-document`;

interface DocRow {
  id: string;
  name: string;
  status: string;
  chunk_count: number;
  size: number;
  mime_type: string | null;
  created_at: string;
  space_id: string | null;
}

interface LogRow {
  id: string;
  query: string;
  mode: string;
  results_count: number;
  latency_ms: number;
  success: boolean;
  created_at: string;
  space_id: string | null;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function Admin() {
  const { user, loading } = useAuth();
  const { spaces, activeSpaceId, setActiveSpaceId } = useSpaces(user?.id ?? null);
  const { uploadDocument } = useAgentChat(user?.id ?? null, activeSpaceId);

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeSpace = spaces.find((s) => s.id === activeSpaceId) || null;

  const load = useCallback(async () => {
    if (!user?.id) return;
    setRefreshing(true);
    let docQuery = supabase
      .from("documents")
      .select("id, name, status, chunk_count, size, mime_type, created_at, space_id");
    docQuery = activeSpaceId ? docQuery.eq("space_id", activeSpaceId) : docQuery.is("space_id", null);
    const [{ data: docData, error: docErr }, { data: logData, error: logErr }] = await Promise.all([
      docQuery.order("created_at", { ascending: false }),
      supabase
        .from("search_logs")
        .select("id, query, mode, results_count, latency_ms, success, created_at, space_id")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (docErr) toast.error(docErr.message);
    if (logErr) toast.error(logErr.message);
    setDocs((docData as DocRow[]) || []);
    setLogs((logData as LogRow[]) || []);
    setRefreshing(false);
  }, [user?.id, activeSpaceId]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const totalChunks = docs.reduce((s, d) => s + (d.chunk_count || 0), 0);
    const totalSize = docs.reduce((s, d) => s + (d.size || 0), 0);
    const avgLatency = logs.length
      ? Math.round(logs.reduce((s, l) => s + (l.latency_ms || 0), 0) / logs.length)
      : 0;
    const failed = logs.filter((l) => !l.success).length;
    return { totalChunks, totalSize, avgLatency, failed };
  }, [docs, logs]);

  const handleReindex = async (id: string) => {
    setBusyId(id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const resp = await fetch(REINDEX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.session?.access_token || ""}`,
        },
        body: JSON.stringify({ documentId: id }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Re-index failed");
      toast.success(`Re-indexed ${json.reindexed}/${json.total} chunks`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-index failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    await supabase.from("document_chunks").delete().eq("document_id", id);
    const { error } = await supabase.from("documents").delete().eq("id", id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Document deleted");
    load();
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      await uploadDocument(file);
    }
    load();
  };

  const clearLogs = async () => {
    const { error } = await supabase.from("search_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { toast.error(error.message); return; }
    toast.success("Logs cleared");
    load();
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-pink border-t-transparent" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen bg-background px-4 py-6 md:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-1.5 rounded-lg border border-neon-pink/30 bg-card/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-neon-pink transition-all hover:bg-neon-pink/10"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Link>
            <div>
              <h1 className="text-lg font-bold text-neon-pink" style={{ textShadow: "0 0 14px hsl(330 100% 62% / 0.45)" }}>
                Admin Dashboard
              </h1>
              <p className="text-[11px] text-muted-foreground">
                Indexing status · Re-index · Logs · Analytics
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/knowledge"
              className="flex items-center gap-1.5 rounded-lg border border-neon-cyan/30 bg-neon-cyan/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-neon-cyan transition-all hover:bg-neon-cyan/10"
            >
              <Network className="h-3.5 w-3.5" /> Connect
            </Link>
            <Link
              to="/spaces"
              className="flex items-center gap-1.5 rounded-lg border border-neon-purple/30 bg-neon-purple/5 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-neon-purple transition-all hover:bg-neon-purple/10"
            >
              <Layers className="h-3.5 w-3.5" /> Spaces
            </Link>
            <button
              onClick={load}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition-all hover:text-foreground"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        {/* Scope */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neon-purple/20 bg-card/50 p-3">
          <ShieldCheck className="h-4 w-4 text-neon-purple" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Scope</span>
          <select
            value={activeSpaceId ?? ""}
            onChange={(e) => setActiveSpaceId(e.target.value || null)}
            className="rounded-lg border border-neon-purple/30 bg-background px-2.5 py-1.5 text-xs text-foreground outline-none"
          >
            <option value="">Personal Workspace</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>{s.name} · {domainLabel(s.domain)}</option>
            ))}
          </select>
          {activeSpace && (
            <span className="rounded border border-neon-purple/30 bg-neon-purple/10 px-2 py-0.5 font-mono text-[10px] text-neon-purple">
              {activeSpace.is_private ? "private" : "shared"}
            </span>
          )}
        </div>

        {/* Analytics */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard icon={FileText} label="Documents" value={String(docs.length)} accent="text-neon-pink" border="border-neon-pink/25" />
          <StatCard icon={Database} label="Chunks" value={String(stats.totalChunks)} accent="text-neon-cyan" border="border-neon-cyan/25" />
          <StatCard icon={Clock} label="Avg latency" value={`${stats.avgLatency} ms`} accent="text-neon-green" border="border-neon-green/25" />
          <StatCard icon={Activity} label="Queries logged" value={String(logs.length)} accent="text-neon-purple" border="border-neon-purple/25" />
        </div>

        {/* Upload */}
        <div className="rounded-xl border border-neon-pink/20 bg-card/50 p-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-pink">
            <Upload className="h-3.5 w-3.5" /> Upload documents
          </div>
          <p className="mb-3 text-[11px] text-muted-foreground">
            PDF, DOCX, PPTX, TXT, MD, CSV, Excel · total indexed size {formatBytes(stats.totalSize)}
          </p>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.docx,.pptx,.txt,.md,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.tif,.tiff"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-neon-pink/40 bg-neon-pink/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-neon-pink transition-all hover:bg-neon-pink/20"
          >
            Choose files
          </button>
        </div>

        {/* Indexing status */}
        <div className="rounded-xl border border-neon-cyan/20 bg-card/50 p-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-cyan">
            <Database className="h-3.5 w-3.5" /> Indexing status
          </div>
          {docs.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No documents indexed in this scope yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="border-b border-border/60 px-2 py-2 text-left">Document</th>
                    <th className="border-b border-border/60 px-2 py-2 text-left">Status</th>
                    <th className="border-b border-border/60 px-2 py-2 text-right">Chunks</th>
                    <th className="border-b border-border/60 px-2 py-2 text-right">Size</th>
                    <th className="border-b border-border/60 px-2 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id} className="text-foreground/85">
                      <td className="max-w-[240px] truncate border-b border-border/30 px-2 py-2 font-medium">{d.name}</td>
                      <td className="border-b border-border/30 px-2 py-2">
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                            d.status === "ready"
                              ? "border-neon-green/40 bg-neon-green/10 text-neon-green"
                              : d.status === "error"
                              ? "border-neon-red/40 bg-neon-red/10 text-neon-red"
                              : "border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan"
                          }`}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td className="border-b border-border/30 px-2 py-2 text-right font-mono">{d.chunk_count}</td>
                      <td className="border-b border-border/30 px-2 py-2 text-right font-mono">{formatBytes(d.size)}</td>
                      <td className="border-b border-border/30 px-2 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleReindex(d.id)}
                            disabled={busyId === d.id}
                            title="Re-index embeddings"
                            className="rounded-md border border-neon-cyan/40 p-1.5 text-neon-cyan transition-all hover:bg-neon-cyan/10 disabled:opacity-50"
                          >
                            {busyId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          </button>
                          <button
                            onClick={() => handleDelete(d.id)}
                            disabled={busyId === d.id}
                            title="Delete document"
                            className="rounded-md border border-neon-red/40 p-1.5 text-neon-red transition-all hover:bg-neon-red/10 disabled:opacity-50"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Logs */}
        <div className="rounded-xl border border-neon-green/20 bg-card/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-green">
              <Search className="h-3.5 w-3.5" /> Query logs
              {stats.failed > 0 && (
                <span className="rounded border border-neon-red/40 bg-neon-red/10 px-1.5 py-0.5 font-mono text-[10px] text-neon-red">
                  {stats.failed} failed
                </span>
              )}
            </div>
            {logs.length > 0 && (
              <button
                onClick={clearLogs}
                className="rounded-lg border border-border px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground transition-all hover:text-neon-red"
              >
                Clear
              </button>
            )}
          </div>
          {logs.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No queries logged yet. Ask something in chat to start collecting analytics.</p>
          ) : (
            <ul className="space-y-1.5">
              {logs.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-background/40 px-2.5 py-1.5 text-[11px]">
                  <span className={`font-mono text-[10px] ${l.success ? "text-neon-green" : "text-neon-red"}`}>
                    {l.success ? "OK" : "ERR"}
                  </span>
                  <span className="rounded border border-neon-purple/30 bg-neon-purple/10 px-1.5 py-0.5 font-mono text-[10px] text-neon-purple">
                    {l.mode}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground/85">{l.query}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{l.latency_ms} ms</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {new Date(l.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, accent, border,
}: {
  icon: typeof Activity; label: string; value: string; accent: string; border: string;
}) {
  return (
    <div className={`rounded-xl border ${border} bg-card/50 p-3`}>
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${accent}`} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className={`text-lg font-bold ${accent}`}>{value}</div>
    </div>
  );
}