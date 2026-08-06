import { useCallback, useEffect, useState } from "react";
import { Mail, Plus, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/format";

interface AdminEmailRow {
  email: string;
  has_account: boolean;
  created_at: string;
}

/** Email allowlist: whoever's email is here gets the Admin role on sign-in. */
export function AdminEmails() {
  const [rows, setRows] = useState<AdminEmailRow[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("admin_list_admin_emails");
    if (error) { setRows([]); return; }
    setRows((data as AdminEmailRow[]) || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const value = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(value)) { toast.error("Valid email daalo"); return; }
    setBusy(true);
    const { error } = await (supabase as any).rpc("admin_add_admin_email", { _email: value });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setEmail("");
    toast.success(`${value} ab admin hai`);
    load();
  };

  const remove = async (value: string) => {
    const { error } = await (supabase as any).rpc("admin_remove_admin_email", { _email: value });
    if (error) { toast.error(error.message); return; }
    toast.success("Admin access removed");
    load();
  };

  return (
    <section className="rounded-xl border border-neon-yellow/25 bg-card/50 p-4">
      <h2 className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-yellow">
        <ShieldCheck className="h-3.5 w-3.5" /> Admin emails
      </h2>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Jo email yahan hogi, wahi account admin banega (sign-in par role automatically apply hota hai). Baaki sab users sirf chat kar sakte hain.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3">
          <Mail className="h-3.5 w-3.5 text-neon-yellow" />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="admin@company.com"
            className="w-full bg-transparent py-2 text-sm text-foreground outline-none"
          />
        </div>
        <button
          onClick={add}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-lg border border-neon-yellow/50 bg-neon-yellow/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-neon-yellow transition-all hover:bg-neon-yellow/20 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Make admin
        </button>
      </div>
      <div className="mt-3 space-y-1.5">
        {rows.length === 0 && <p className="text-[11px] text-muted-foreground">Koi admin email list me nahi hai.</p>}
        {rows.map((r) => (
          <div key={r.email} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background/40 px-3 py-1.5 text-[11px]">
            <span className="min-w-0 flex-1 truncate font-mono text-neon-cyan">{r.email}</span>
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
              r.has_account ? "border-neon-green/40 text-neon-green" : "border-border text-muted-foreground"
            }`}>{r.has_account ? "account active" : "no account yet"}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{formatDate(r.created_at)}</span>
            <button
              onClick={() => remove(r.email)}
              className="rounded border border-neon-pink/40 p-1 text-neon-pink/80 transition-colors hover:bg-neon-pink/10"
              title="Remove admin"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
