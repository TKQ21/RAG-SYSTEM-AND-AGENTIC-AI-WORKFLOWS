import { useCallback, useState } from "react";
import { Lock, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const PASS_KEY = "nexus_admin_password";
const UNLOCK_KEY = "nexus_admin_unlocked";
const DEFAULT_PASSWORD = "KQ641000";

export function getAdminPassword(): string {
  return localStorage.getItem(PASS_KEY) || DEFAULT_PASSWORD;
}

export function setAdminPassword(next: string) {
  localStorage.setItem(PASS_KEY, next);
}

interface Props {
  children: React.ReactNode;
}

/** Client-side access gate for the admin dashboard with an in-panel password change option. */
export function AdminPasswordGate({ children }: Props) {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(UNLOCK_KEY) === "1");
  const [value, setValue] = useState("");
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  const submit = useCallback(() => {
    if (value === getAdminPassword()) {
      sessionStorage.setItem(UNLOCK_KEY, "1");
      setUnlocked(true);
      setValue("");
    } else {
      toast.error("Wrong admin password");
    }
  }, [value]);

  if (unlocked) {
    return (
      <div className="relative">
        <div className="mx-auto max-w-5xl px-4 pt-5 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neon-green/25 bg-card/50 p-3">
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-neon-green">
              <ShieldCheck className="h-3.5 w-3.5" /> Admin access unlocked
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setChanging((c) => !c)}
                className="flex items-center gap-1.5 rounded-lg border border-neon-cyan/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-neon-cyan transition-all hover:bg-neon-cyan/10"
              >
                <KeyRound className="h-3 w-3" /> Change password
              </button>
              <button
                onClick={() => { sessionStorage.removeItem(UNLOCK_KEY); setUnlocked(false); }}
                className="rounded-lg border border-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-all hover:text-neon-red"
              >
                Lock
              </button>
            </div>
          </div>
          {changing && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-neon-cyan/20 bg-card/50 p-3">
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="Current password"
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none"
              />
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="New password"
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none"
              />
              <button
                onClick={() => {
                  if (current !== getAdminPassword()) { toast.error("Current password is wrong"); return; }
                  if (next.trim().length < 6) { toast.error("New password must be at least 6 characters"); return; }
                  setAdminPassword(next.trim());
                  setCurrent(""); setNext(""); setChanging(false);
                  toast.success("Admin password updated");
                }}
                className="rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-neon-cyan"
              >
                Save
              </button>
            </div>
          )}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neon-pink/25 bg-card/60 p-6">
        <div className="mb-4 flex items-center gap-2 text-neon-pink">
          <Lock className="h-4 w-4" />
          <h1 className="text-sm font-bold uppercase tracking-wider">Admin panel locked</h1>
        </div>
        <p className="mb-4 text-[11px] text-muted-foreground">
          Enter the admin password to open indexing status, logs and analytics.
        </p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Admin password"
          className="w-full rounded-lg border border-neon-pink/30 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-neon-pink/60"
        />
        <button
          onClick={submit}
          className="mt-3 w-full rounded-lg border border-neon-pink/40 bg-neon-pink/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-neon-pink transition-all hover:bg-neon-pink/20"
        >
          Unlock
        </button>
      </div>
    </div>
  );
}
