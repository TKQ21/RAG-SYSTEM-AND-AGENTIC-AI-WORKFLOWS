import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  ArrowLeft, RefreshCw, Layers, Activity, Clock, FileText, Database, Search,
  Users, ShieldAlert, ShieldCheck, Gauge,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/hooks/useRole";
import { supabase } from "@/integrations/supabase/client";
import { AdminPasswordGate } from "@/components/AdminPasswordGate";
import { SpaceManager } from "@/components/admin/SpaceManager";
import { AdminEmails } from "@/components/admin/AdminEmails";
import { VectorStoreSettings } from "@/components/VectorStoreSettings";
import { formatDate, formatDateTime, formatBytes } from "@/lib/format";

interface UserOverviewRow {
  user_id: string; email: string | null; doc_count: number;
  chunk_count: number; query_count: number; last_active: string;
}
interface GlobalQueryRow {
  id: string; email: string | null; query: string; mode: string;
  latency_ms: number; success: boolean; created_at: string;
}
interface GlobalDocRow {
  id: string; email: string | null; name: string; status: string;
  chunk_count: number; size: number; created_at: string;
}

type Tab = "overview" | "spaces" | "users" | "logs" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "spaces", label: "Knowledge Spaces" },
  { id: "users", label: "Users & Access" },
  { id: "logs", label: "Search Logs" },
  { id: "settings", label: "Settings" },
];

export default function Admin() {
  const { user, loading } = useAuth();
  const { isAdmin, loading: roleLoading } = useRole(user?.id ?? null);

  const [tab, setTab] = useState<Tab>("overview");
  const [userRows, setUserRows] = useState<UserOverviewRow[]>([]);
  const [globalQueries, setGlobalQueries] = useState<GlobalQueryRow[]>([]);
  const [globalDocs, setGlobalDocs] = useState<GlobalDocRow[]>([]);
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setRefreshing(true);
    const api = supabase as any;
    const [ov, gq, gd] = await Promise.all([
      api.rpc("admin_user_overview"),
      api.rpc("admin_recent_queries", { _limit: 500 }),
      api.rpc("admin_recent_documents", { _limit: 500 }),
    ]);
    setUserRows((ov.data as UserOverviewRow[]) || []);
    setGlobalQueries((gq.data as GlobalQueryRow[]) || []);
    setGlobalDocs((gd.data as GlobalDocRow[]) || []);
    setRefreshing(false);
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const perEmail = useMemo(() => {
    const map = new Map<string, { email: string; docs: GlobalDocRow[]; queries: GlobalQueryRow[]; lastActive: number }>();
    const ensure = (email: string | null) => {
      const key = email || "unknown";
      if (!map.has(key)) map.set(key, { email: key, docs: [], queries: [], lastActive: 0 });
      return map.get(key)!;
    };
    userRows.forEach((u) => {
      const e = ensure(u.email);
      e.lastActive = Math.max(e.lastActive, new Date(u.last_active).getTime() || 0);
    });
    globalDocs.forEach((d) => {
      const e = ensure(d.email); e.docs.push(d);
      e.lastActive = Math.max(e.lastActive, new Date(d.created_at).getTime() || 0);
    });
    globalQueries.forEach((q) => {
      const e = ensure(q.email); e.queries.push(q);
      e.lastActive = Math.max(e.lastActive, new Date(q.created_at).getTime() || 0);
    });
    return Array.from(map.values()).sort((a, b) => b.lastActive - a.lastActive);
  }, [userRows, globalDocs, globalQueries]);

  const stats = useMemo(() => {
    const chunks = globalDocs.reduce((s, d) => s + (d.chunk_count || 0), 0);
    const size = globalDocs.reduce((s, d) => s + (d.size || 0), 0);
    const avgLatency = globalQueries.length
      ? Math.round(globalQueries.reduce((s, q) => s + (q.latency_ms || 0), 0) / globalQueries.length)
      : 0;
    const failed = globalQueries.filter((q) => !q.success).length;
    return { chunks, size, avgLatency, failed };
  }, [globalDocs, globalQueries]);

  const clearLogs = async () => {
    const { error } = await supabase.from("search_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { toast.error(error.message); return; }
    toast.success("Logs cleared");
    load();
  };

  if (loading || roleLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-pink border-t-transparent" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-2xl border border-neon-red/30 bg-card/60 p-6 text-center">
          <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-neon-red" />
          <h1 className="mb-1 text-sm font-bold uppercase tracking-wider text-neon-red">Admin access only</h1>
          <p className="mb-4 text-[12px] text-muted-foreground">
            Ye dashboard sirf admin ke liye hai. Aap chat karke knowledge spaces se answers le sakte hain.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-neon-cyan"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to chat
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AdminPasswordGate>
      <div className="min-h-full bg-background px-4 py-6 md:px-8">
        <div className="mx-auto max-w-6xl space-y-5">
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
                <h1 className="flex items-center gap-2 text-lg font-bold text-neon-pink" style={{ textShadow: "0 0 14px hsl(330 100% 62% / 0.45)" }}>
                  <Gauge className="h-4 w-4" /> Admin Dashboard
                </h1>
                <p className="text-[11px] text-muted-foreground">
                  Knowledge spaces · uploads · connected sources · users · analytics
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-lg border border-neon-green/30 bg-neon-green/5 px-3 py-1.5 font-mono text-[10px] text-neon-green">
                <ShieldCheck className="h-3.5 w-3.5" /> {user.email}
              </span>
              <button
                onClick={load}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-card/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition-all hover:text-foreground"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-border/60 bg-card/40 p-1.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all ${
                  tab === t.id
                    ? "border border-neon-pink/50 bg-neon-pink/10 text-neon-pink"
                    : "border border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard icon={FileText} label="Documents" value={String(globalDocs.length)} accent="text-neon-pink" border="border-neon-pink/25" />
                <StatCard icon={Database} label="Chunks" value={String(stats.chunks)} accent="text-neon-cyan" border="border-neon-cyan/25" />
                <StatCard icon={Clock} label="Avg latency" value={`${stats.avgLatency} ms`} accent="text-neon-green" border="border-neon-green/25" />
                <StatCard icon={Users} label="Total users" value={String(userRows.length)} accent="text-neon-purple" border="border-neon-purple/25" />
              </div>

              <div className="rounded-xl border border-neon-pink/20 bg-card/50 p-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-pink">
                  <FileText className="h-3.5 w-3.5" /> All indexed knowledge ({globalDocs.length}) · {formatBytes(stats.size)}
                </div>
                {globalDocs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">Kuch index nahi hua — Knowledge Spaces tab se documents ya sources add karo.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {globalDocs.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-background/40 px-2.5 py-1.5 text-[11px]">
                        <span className="font-mono text-[10px] text-neon-cyan">{d.email || "unknown"}</span>
                        <span className="min-w-0 flex-1 truncate text-foreground/85">{d.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{d.chunk_count} chunks · {formatBytes(d.size)}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{formatDate(d.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {tab === "spaces" && <SpaceManager userId={user.id} />}

          {tab === "users" && (
            <>
              <AdminEmails />

              <div className="rounded-xl border border-neon-purple/25 bg-card/50 p-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-purple">
                  <Users className="h-3.5 w-3.5" /> Users ({userRows.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="border-b border-border/60 px-2 py-2 text-left">User</th>
                        <th className="border-b border-border/60 px-2 py-2 text-left">User ID</th>
                        <th className="border-b border-border/60 px-2 py-2 text-right">Docs</th>
                        <th className="border-b border-border/60 px-2 py-2 text-right">Queries</th>
                        <th className="border-b border-border/60 px-2 py-2 text-right">Last active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userRows.map((u) => (
                        <tr key={u.user_id} className="text-foreground/85">
                          <td className="max-w-[200px] truncate border-b border-border/30 px-2 py-2 font-medium">{u.email || u.user_id}</td>
                          <td className="border-b border-border/30 px-2 py-2 font-mono text-[10px] text-muted-foreground">{u.user_id}</td>
                          <td className="border-b border-border/30 px-2 py-2 text-right font-mono">{u.doc_count}</td>
                          <td className="border-b border-border/30 px-2 py-2 text-right font-mono">{u.query_count}</td>
                          <td className="border-b border-border/30 px-2 py-2 text-right font-mono text-[10px] text-muted-foreground">
                            {formatDateTime(u.last_active)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-neon-green/25 bg-card/50 p-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-green">
                  <Activity className="h-3.5 w-3.5" /> Activity by email ({perEmail.length})
                </div>
                {perEmail.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No user activity yet.</p>
                ) : (
                  <div className="space-y-2">
                    {perEmail.map((u) => {
                      const open = openEmail === u.email;
                      return (
                        <div key={u.email} className="rounded-lg border border-border/40 bg-background/40">
                          <button
                            onClick={() => setOpenEmail(open ? null : u.email)}
                            className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-[11px]"
                          >
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neon-cyan">{u.email}</span>
                            <span className="rounded border border-neon-pink/30 bg-neon-pink/10 px-1.5 py-0.5 font-mono text-[10px] text-neon-pink">{u.docs.length} docs</span>
                            <span className="rounded border border-neon-purple/30 bg-neon-purple/10 px-1.5 py-0.5 font-mono text-[10px] text-neon-purple">{u.queries.length} questions</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{u.lastActive ? formatDateTime(u.lastActive) : "—"}</span>
                          </button>
                          {open && (
                            <div className="grid gap-3 border-t border-border/40 px-3 py-3 md:grid-cols-2">
                              <div>
                                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neon-pink">
                                  <FileText className="h-3 w-3" /> Documents uploaded
                                </div>
                                {u.docs.length === 0 ? (
                                  <p className="text-[11px] text-muted-foreground">No uploads.</p>
                                ) : (
                                  <ul className="space-y-1">
                                    {u.docs.map((d) => (
                                      <li key={d.id} className="flex items-center gap-2 rounded border border-border/30 px-2 py-1 text-[11px]">
                                        <span className="min-w-0 flex-1 truncate text-foreground/85">{d.name}</span>
                                        <span className="font-mono text-[10px] text-muted-foreground">{d.chunk_count} chunks</span>
                                        <span className="font-mono text-[10px] text-muted-foreground">{formatDate(d.created_at)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div>
                                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neon-cyan">
                                  <Search className="h-3 w-3" /> Questions asked
                                </div>
                                {u.queries.length === 0 ? (
                                  <p className="text-[11px] text-muted-foreground">No questions.</p>
                                ) : (
                                  <ul className="space-y-1">
                                    {u.queries.map((q) => (
                                      <li key={q.id} className="flex items-center gap-2 rounded border border-border/30 px-2 py-1 text-[11px]">
                                        <span className="rounded border border-neon-purple/30 bg-neon-purple/10 px-1 font-mono text-[9px] text-neon-purple">{q.mode}</span>
                                        <span className="min-w-0 flex-1 truncate text-foreground/85">{q.query}</span>
                                        <span className="font-mono text-[10px] text-muted-foreground">{formatDate(q.created_at)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "logs" && (
            <div className="rounded-xl border border-neon-cyan/20 bg-card/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-cyan">
                  <Search className="h-3.5 w-3.5" /> Search logs (every user)
                  {stats.failed > 0 && (
                    <span className="rounded border border-neon-red/40 bg-neon-red/10 px-1.5 py-0.5 font-mono text-[10px] text-neon-red">
                      {stats.failed} failed
                    </span>
                  )}
                </div>
                {globalQueries.length > 0 && (
                  <button
                    onClick={clearLogs}
                    className="rounded-lg border border-border px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground transition-all hover:text-neon-red"
                  >
                    Clear
                  </button>
                )}
              </div>
              {globalQueries.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No queries logged yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {globalQueries.map((q) => (
                    <li key={q.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-background/40 px-2.5 py-1.5 text-[11px]">
                      <span className={`font-mono text-[10px] ${q.success ? "text-neon-green" : "text-neon-red"}`}>{q.success ? "OK" : "ERR"}</span>
                      <span className="font-mono text-[10px] text-neon-cyan">{q.email || "unknown"}</span>
                      <span className="rounded border border-neon-purple/30 bg-neon-purple/10 px-1.5 py-0.5 font-mono text-[10px] text-neon-purple">{q.mode}</span>
                      <span className="min-w-0 flex-1 truncate text-foreground/85">{q.query}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{q.latency_ms} ms</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{formatDateTime(q.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "settings" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-neon-cyan/25 bg-card/50 p-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-cyan">
                  <Layers className="h-3.5 w-3.5" /> Vector database
                </div>
                <VectorStoreSettings />
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminPasswordGate>
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
