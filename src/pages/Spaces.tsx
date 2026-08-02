import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Lock, Globe, Users, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useSpaces, listMembers, addMember, removeMember, myRoles, type SpaceMember } from "@/hooks/useSpaces";
import { ACCESS_LEVELS, DOMAIN_PRESETS, domainLabel, type AccessLevel } from "@/lib/spaces";

export default function Spaces() {
  const { user, loading } = useAuth();
  const { spaces, activeSpaceId, setActiveSpaceId, createSpace, updateSpace, deleteSpace } = useSpaces(user?.id ?? null);

  const [name, setName] = useState("");
  const [domain, setDomain] = useState(DOMAIN_PRESETS[0].id);
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [memberId, setMemberId] = useState("");
  const [level, setLevel] = useState<AccessLevel>("viewer");
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    if (user?.id) myRoles(user.id).then(setRoles);
  }, [user?.id]);

  useEffect(() => {
    if (!selected) { setMembers([]); return; }
    listMembers(selected).then(setMembers).catch((e) => toast.error(e.message));
  }, [selected]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-pink border-t-transparent" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  const handleCreate = async () => {
    if (!name.trim()) { toast.error("Space ka naam do"); return; }
    setBusy(true);
    try {
      const space = await createSpace({ name: name.trim(), domain, isPrivate });
      setName("");
      setSelected(space.id);
      toast.success(`${space.name} created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const handleAddMember = async () => {
    if (!selected || !memberId.trim()) return;
    try {
      await addMember(selected, memberId.trim(), level);
      setMembers(await listMembers(selected));
      setMemberId("");
      toast.success("Member added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Add failed");
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center gap-3">
          <Link to="/" className="rounded-lg border border-neon-pink/30 p-2 text-neon-pink/80 transition-all hover:bg-neon-pink/10">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-black uppercase tracking-wider text-foreground">Knowledge Spaces</h1>
            <p className="font-mono text-[11px] text-muted-foreground">
              Domain-agnostic spaces · same RAG engine · private by default
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 rounded-lg border border-neon-cyan/30 bg-secondary/40 px-3 py-1.5 font-mono text-[10px] text-neon-cyan">
            <ShieldCheck className="h-3.5 w-3.5" />
            {roles.length ? roles.join(" · ") : "user"}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Create */}
          <section className="rounded-xl border border-neon-purple/30 bg-card/50 p-4" style={{ boxShadow: "0 0 16px hsl(280 100% 65% / 0.12)" }}>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-neon-purple">Create space</h2>
            <div className="space-y-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cardiology Guidelines"
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground outline-none focus:border-neon-purple/60"
              />
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground outline-none focus:border-neon-purple/60"
              >
                {DOMAIN_PRESETS.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="accent-[hsl(280_100%_65%)]" />
                Private space (only invited members can read)
              </label>
              <button
                onClick={handleCreate}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-neon-purple/50 bg-neon-purple/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-neon-purple transition-all hover:bg-neon-purple/20 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create
              </button>
            </div>
          </section>

          {/* List */}
          <section className="rounded-xl border border-neon-cyan/30 bg-card/50 p-4" style={{ boxShadow: "0 0 16px hsl(185 100% 50% / 0.12)" }}>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-neon-cyan">Your spaces</h2>
            {spaces.length === 0 && <p className="text-[11px] text-muted-foreground">Koi space nahi hai — pehla space banao.</p>}
            <div className="space-y-2">
              {spaces.map((s) => (
                <div
                  key={s.id}
                  className={`rounded-lg border px-3 py-2 ${selected === s.id ? "border-neon-cyan/60 bg-neon-cyan/5" : "border-border/60 bg-secondary/20"}`}
                >
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelected(s.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-medium text-foreground">{s.name}</div>
                      <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                        {s.is_private ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                        {domainLabel(s.domain)}
                      </div>
                    </button>
                    <button
                      onClick={() => setActiveSpaceId(activeSpaceId === s.id ? null : s.id)}
                      className={`rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${activeSpaceId === s.id ? "border-neon-pink/60 text-neon-pink" : "border-border text-muted-foreground"}`}
                    >
                      {activeSpaceId === s.id ? "Active" : "Use"}
                    </button>
                    {s.owner_id === user.id && (
                      <>
                        <button
                          onClick={() => updateSpace(s.id, { is_private: !s.is_private }).catch((e) => toast.error(e.message))}
                          className="rounded border border-border p-1 text-muted-foreground transition-colors hover:text-neon-cyan"
                          title={s.is_private ? "Make shared" : "Make private"}
                        >
                          {s.is_private ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        </button>
                        <button
                          onClick={() => deleteSpace(s.id).then(() => setSelected(null)).catch((e) => toast.error(e.message))}
                          className="rounded border border-neon-pink/40 p-1 text-neon-pink/80 transition-colors hover:bg-neon-pink/10"
                          title="Delete space"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Members / permissions */}
        {selected && (
          <section className="mt-4 rounded-xl border border-neon-pink/30 bg-card/50 p-4" style={{ boxShadow: "0 0 16px hsl(330 100% 62% / 0.12)" }}>
            <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neon-pink">
              <Users className="h-3.5 w-3.5" /> Access control
            </h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                placeholder="Member user ID (UUID)"
                className="flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground outline-none focus:border-neon-pink/60"
              />
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as AccessLevel)}
                className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground outline-none"
              >
                {ACCESS_LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <button
                onClick={handleAddMember}
                className="rounded-lg border border-neon-pink/50 bg-neon-pink/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-neon-pink transition-all hover:bg-neon-pink/20"
              >
                Add
              </button>
            </div>
            <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
              viewer = read only · editor = upload & index · admin = manage members
            </p>
            <div className="mt-3 space-y-1.5">
              {members.length === 0 && <p className="text-[11px] text-muted-foreground">Sirf owner ke paas access hai.</p>}
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{m.user_id}</span>
                  <span className="rounded border border-neon-cyan/40 px-2 py-0.5 font-mono text-[9px] uppercase text-neon-cyan">{m.access_level}</span>
                  <button
                    onClick={async () => {
                      try {
                        await removeMember(m.id);
                        setMembers(await listMembers(selected));
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
        )}
      </div>
    </div>
  );
}