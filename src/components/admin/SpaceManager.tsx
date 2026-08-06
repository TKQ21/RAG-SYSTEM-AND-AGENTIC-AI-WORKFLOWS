import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, Trash2, Lock, Globe, Loader2, Upload, RefreshCw, Plug, FileText,
  Users, Layers, Server, Github, Database,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSpaces, listMembers, addMember, removeMember, type SpaceMember, type KnowledgeSpace } from "@/hooks/useSpaces";
import { useAgentChat } from "@/hooks/useAgentChat";
import { ACCESS_LEVELS, DOMAIN_PRESETS, domainLabel, type AccessLevel } from "@/lib/spaces";
import { SOURCE_DEFINITIONS, ingestExternalSource, type SourceDefinition } from "@/lib/knowledgeSources";
import { formatDate, formatBytes } from "@/lib/format";

const REINDEX_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reindex-document`;

interface SpaceDoc {
  id: string;
  name: string;
  status: string;
  chunk_count: number;
  size: number;
  mime_type: string | null;
  created_at: string;
}

/** Sources an admin can attach without extra credentials. */
const CONNECTABLE = SOURCE_DEFINITIONS.filter((s) => !!s.ingestKind);

function sourceIcon(source: SourceDefinition) {
  if (source.id === "github") return Github;
  if (source.kind === "rest") return Server;
  return Globe;
}

export function SpaceManager({ userId }: { userId: string }) {
  const { spaces, activeSpaceId, setActiveSpaceId, createSpace, updateSpace, deleteSpace, refresh } = useSpaces(userId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: KnowledgeSpace | null = useMemo(
    () => spaces.find((s) => s.id === selectedId) || null,
    [spaces, selectedId],
  );

  // create form
  const [name, setName] = useState("");
  const [domain, setDomain] = useState(DOMAIN_PRESETS[0].id);
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) { toast.error("Knowledge space ka naam do"); return; }
    setCreating(true);
    try {
      const space = await createSpace({ name: name.trim(), domain, description: description.trim(), isPrivate });
      setName(""); setDescription("");
      setSelectedId(space.id);
      setActiveSpaceId(space.id);
      toast.success(`${space.name} created — ab documents / sources add karo`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Create */}
      <section className="rounded-xl border border-neon-purple/25 bg-card/50 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-purple">
          <Plus className="h-3.5 w-3.5" /> Create knowledge space
        </h2>
        <div className="grid gap-2 md:grid-cols-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Space name (e.g. Banking)"
            className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground outline-none focus:border-neon-purple/60"
          />
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground outline-none focus:border-neon-purple/60"
          >
            {DOMAIN_PRESETS.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground outline-none focus:border-neon-purple/60"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center justify-center gap-2 rounded-lg border border-neon-purple/50 bg-neon-purple/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-neon-purple transition-all hover:bg-neon-purple/20 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create
          </button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          Private space (only assigned members can read) — uncheck to let every signed-in user chat with it
        </label>
      </section>

      {/* Spaces list */}
      <section className="rounded-xl border border-neon-cyan/25 bg-card/50 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-cyan">
          <Layers className="h-3.5 w-3.5" /> Knowledge spaces ({spaces.length})
        </h2>
        {spaces.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Koi space nahi hai — upar se pehla space banao.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {spaces.map((s) => (
              <div
                key={s.id}
                className={`rounded-lg border px-3 py-2 transition-all ${
                  selectedId === s.id ? "border-neon-cyan/60 bg-neon-cyan/5" : "border-border/60 bg-secondary/20"
                }`}
              >
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelectedId(s.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-medium text-foreground">{s.name}</div>
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                      {s.is_private ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                      {domainLabel(s.domain)} · {formatDate(s.created_at)}
                    </div>
                  </button>
                  <button
                    onClick={() => updateSpace(s.id, { is_private: !s.is_private }).catch((e) => toast.error(e.message))}
                    title={s.is_private ? "Make shared" : "Make private"}
                    className="rounded border border-border p-1 text-muted-foreground transition-colors hover:text-neon-cyan"
                  >
                    {s.is_private ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm(`Delete space "${s.name}"? Uske documents bhi hat jaayenge.`)) return;
                      deleteSpace(s.id)
                        .then(() => { if (selectedId === s.id) setSelectedId(null); toast.success("Space deleted"); })
                        .catch((e) => toast.error(e.message));
                    }}
                    title="Delete space"
                    className="rounded border border-neon-pink/40 p-1 text-neon-pink/80 transition-colors hover:bg-neon-pink/10"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {selected ? (
        <SpaceWorkbench key={selected.id} space={selected} userId={userId} onChanged={refresh} />
      ) : (
        <p className="rounded-xl border border-border/50 bg-card/40 p-4 text-[11px] text-muted-foreground">
          Ek space select karo — uska document library, uploads, connected sources aur access control yahan khulega.
        </p>
      )}
    </div>
  );
}

/** Everything scoped to a single knowledge space: library, uploads, sources, members. */
function SpaceWorkbench({ space, userId, onChanged }: { space: KnowledgeSpace; userId: string; onChanged: () => void }) {
  const { uploadDocument } = useAgentChat(userId, space.id);
  const [docs, setDocs] = useState<SpaceDoc[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // connect-source form
  const [sourceId, setSourceId] = useState(CONNECTABLE[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(12);
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const source = CONNECTABLE.find((s) => s.id === sourceId) || CONNECTABLE[0];

  // members
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [memberId, setMemberId] = useState("");
  const [level, setLevel] = useState<AccessLevel>("viewer");

  const loadDocs = useCallback(async () => {
    setLoadingDocs(true);
    const { data, error } = await supabase
      .from("documents")
      .select("id, name, status, chunk_count, size, mime_type, created_at")
      .eq("space_id", space.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setDocs((data as SpaceDoc[]) || []);
    setLoadingDocs(false);
  }, [space.id]);

  useEffect(() => { loadDocs(); }, [loadDocs]);
  useEffect(() => { listMembers(space.id).then(setMembers).catch(() => setMembers([])); }, [space.id]);

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      await uploadDocument(file);
    }
    setUploading(false);
    await loadDocs();
    onChanged();
  };

  const handleIngest = async () => {
    if (!source?.ingestKind) return;
    if (!/^https?:\/\//i.test(url.trim())) { toast.error("Full http(s) URL do"); return; }
    setIngesting(true);
    try {
      const result = await ingestExternalSource({
        sourceType: source.ingestKind,
        url: url.trim(),
        maxPages,
        apiKeyHeader: headerName.trim() || undefined,
        apiKeyValue: headerValue.trim() || undefined,
        reindex: true,
        spaceId: space.id,
      });
      toast.success(`Indexed ${result.chunkCount} chunks from ${result.documentName}`);
      setUrl("");
      await loadDocs();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ingestion failed");
    } finally {
      setIngesting(false);
    }
  };

  const handleReindex = async (id: string) => {
    setBusyId(id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const resp = await fetch(REINDEX_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sess.session?.access_token || ""}` },
        body: JSON.stringify({ documentId: id }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Re-index failed");
      toast.success(`Re-indexed ${json.reindexed}/${json.total} chunks`);
      await loadDocs();
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
    await loadDocs();
    onChanged();
  };

  const totals = useMemo(() => ({
    chunks: docs.reduce((s, d) => s + (d.chunk_count || 0), 0),
    size: docs.reduce((s, d) => s + (d.size || 0), 0),
  }), [docs]);

  return (
    <div className="space-y-4 rounded-2xl border border-neon-pink/25 bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-neon-pink" style={{ textShadow: "0 0 12px hsl(330 100% 62% / 0.4)" }}>
          {space.name}
        </h2>
        <span className="rounded border border-neon-purple/30 bg-neon-purple/10 px-2 py-0.5 font-mono text-[10px] text-neon-purple">
          {domainLabel(space.domain)}
        </span>
        <span className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {space.is_private ? "private" : "shared"}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {docs.length} docs · {totals.chunks} chunks · {formatBytes(totals.size)}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Upload */}
        <section className="rounded-xl border border-neon-pink/20 bg-background/40 p-3">
          <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-pink">
            <Upload className="h-3.5 w-3.5" /> Upload documents
          </h3>
          <p className="mb-2 text-[11px] text-muted-foreground">
            PDF · DOCX · TXT · CSV · Excel · Markdown · PPTX · scanned images (auto OCR). Sirf isi space me index honge.
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
            disabled={uploading}
            className="flex items-center gap-2 rounded-lg border border-neon-pink/40 bg-neon-pink/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-neon-pink transition-all hover:bg-neon-pink/20 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? "Indexing…" : "Choose files"}
          </button>
        </section>

        {/* Connect source */}
        <section className="rounded-xl border border-neon-cyan/20 bg-background/40 p-3">
          <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-cyan">
            <Plug className="h-3.5 w-3.5" /> Connect external source
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {CONNECTABLE.map((s) => {
              const Icon = sourceIcon(s);
              return (
                <button
                  key={s.id}
                  onClick={() => setSourceId(s.id)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] transition-all ${
                    sourceId === s.id
                      ? "border-neon-cyan/60 bg-neon-cyan/10 text-neon-cyan"
                      : "border-border text-muted-foreground hover:border-neon-cyan/40"
                  }`}
                >
                  <Icon className="h-3 w-3" /> {s.label}
                </button>
              );
            })}
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={source?.placeholder}
            className="mt-2 w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground outline-none focus:border-neon-cyan/60"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              Max pages
              <input
                type="number" min={1} max={60} value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
                className="w-16 rounded border border-border bg-secondary/40 px-2 py-1 text-xs text-foreground outline-none"
              />
            </label>
            {source?.kind === "rest" && (
              <>
                <input
                  value={headerName} onChange={(e) => setHeaderName(e.target.value)}
                  placeholder="Auth header"
                  className="w-32 rounded border border-border bg-secondary/40 px-2 py-1 text-[11px] text-foreground outline-none"
                />
                <input
                  value={headerValue} onChange={(e) => setHeaderValue(e.target.value)}
                  placeholder="Auth value"
                  className="w-32 rounded border border-border bg-secondary/40 px-2 py-1 text-[11px] text-foreground outline-none"
                />
              </>
            )}
            <button
              onClick={handleIngest}
              disabled={ingesting}
              className="flex items-center gap-2 rounded-lg border border-neon-cyan/50 bg-neon-cyan/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-neon-cyan transition-all hover:bg-neon-cyan/20 disabled:opacity-50"
            >
              {ingesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {ingesting ? "Indexing…" : "Connect & index"}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">{source?.hint}</p>
        </section>
      </div>

      {/* Document library */}
      <section className="rounded-xl border border-neon-green/20 bg-background/40 p-3">
        <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-green">
          <FileText className="h-3.5 w-3.5" /> Document library — {space.name}
        </h3>
        {loadingDocs ? (
          <Loader2 className="h-4 w-4 animate-spin text-neon-green" />
        ) : docs.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Is space me abhi kuch indexed nahi hai.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="border-b border-border/60 px-2 py-2 text-left">Document / source</th>
                  <th className="border-b border-border/60 px-2 py-2 text-left">Index status</th>
                  <th className="border-b border-border/60 px-2 py-2 text-right">Chunks</th>
                  <th className="border-b border-border/60 px-2 py-2 text-right">Size</th>
                  <th className="border-b border-border/60 px-2 py-2 text-right">Added</th>
                  <th className="border-b border-border/60 px-2 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="text-foreground/85">
                    <td className="max-w-[240px] truncate border-b border-border/30 px-2 py-2 font-medium">{d.name}</td>
                    <td className="border-b border-border/30 px-2 py-2">
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                        d.status === "ready"
                          ? "border-neon-green/40 bg-neon-green/10 text-neon-green"
                          : d.status === "error"
                          ? "border-neon-red/40 bg-neon-red/10 text-neon-red"
                          : "border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan"
                      }`}>{d.status}</span>
                    </td>
                    <td className="border-b border-border/30 px-2 py-2 text-right font-mono">{d.chunk_count}</td>
                    <td className="border-b border-border/30 px-2 py-2 text-right font-mono">{formatBytes(d.size)}</td>
                    <td className="border-b border-border/30 px-2 py-2 text-right font-mono text-[10px] text-muted-foreground">{formatDate(d.created_at)}</td>
                    <td className="border-b border-border/30 px-2 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleReindex(d.id)} disabled={busyId === d.id} title="Re-index"
                          className="rounded-md border border-neon-cyan/40 p-1.5 text-neon-cyan transition-all hover:bg-neon-cyan/10 disabled:opacity-50"
                        >
                          {busyId === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        </button>
                        <button
                          onClick={() => handleDelete(d.id)} disabled={busyId === d.id} title="Delete"
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
      </section>

      {/* Access control */}
      <section className="rounded-xl border border-neon-purple/20 bg-background/40 p-3">
        <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-purple">
          <Users className="h-3.5 w-3.5" /> Access control
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            placeholder="User ID (UUID) — assign this space to a user"
            className="flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground outline-none focus:border-neon-purple/60"
          />
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as AccessLevel)}
            className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground outline-none"
          >
            {ACCESS_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button
            onClick={async () => {
              if (!memberId.trim()) return;
              try {
                await addMember(space.id, memberId.trim(), level);
                setMembers(await listMembers(space.id));
                setMemberId("");
                toast.success("Member added");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Add failed");
              }
            }}
            className="rounded-lg border border-neon-purple/50 bg-neon-purple/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-neon-purple transition-all hover:bg-neon-purple/20"
          >
            Assign
          </button>
        </div>
        <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
          viewer = chat / read only · editor = can index · admin = manage members
        </p>
        <div className="mt-2 space-y-1.5">
          {members.length === 0 && <p className="text-[11px] text-muted-foreground">Sirf owner ke paas access hai (shared space sab ke liye readable hota hai).</p>}
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{m.user_id}</span>
              <span className="rounded border border-neon-cyan/40 px-2 py-0.5 font-mono text-[9px] uppercase text-neon-cyan">{m.access_level}</span>
              <button
                onClick={async () => {
                  try {
                    await removeMember(m.id);
                    setMembers(await listMembers(space.id));
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Remove failed");
                  }
                }}
                className="rounded border border-neon-pink/40 p-1 text-neon-pink/80 transition-colors hover:bg-neon-pink/10"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
