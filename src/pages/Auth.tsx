import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, Mail, Lock, Loader2, Sparkles, Zap, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

type Mode = "signin" | "signup";

export default function Auth() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Account created. You're in!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error instanceof Error ? result.error : new Error(String(result.error));
      // if redirected, browser will navigate away
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Animated neon backdrop */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-neon-pink/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-neon-cyan/20 blur-3xl" />
        <div className="absolute top-1/3 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-neon-purple/20 blur-3xl" />
      </div>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(330 100% 62% / 1) 1px, transparent 1px), linear-gradient(90deg, hsl(185 100% 50% / 1) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Card */}
        <div
          className="rounded-2xl border border-neon-pink/30 bg-card/70 p-8 backdrop-blur-2xl"
          style={{ boxShadow: "0 0 60px hsl(330 100% 62% / 0.25), inset 0 0 30px hsl(280 100% 65% / 0.06)" }}
        >
          {/* Brand */}
          <div className="mb-7 text-center">
            <motion.div
              initial={{ rotate: -10, scale: 0.8 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 180 }}
              className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-neon-pink/50 bg-secondary/60"
              style={{ boxShadow: "0 0 28px hsl(330 100% 62% / 0.55)" }}
            >
              <Brain className="h-7 w-7 text-neon-pink" />
            </motion.div>
            <h1
              className="text-4xl sm:text-5xl font-black uppercase tracking-[0.18em] text-foreground"
              style={{ textShadow: "0 0 24px hsl(330 100% 62% / 0.7)" }}
            >
              NEXUS RAG
            </h1>
            <p className="mt-2 font-mono text-[11px] sm:text-xs uppercase tracking-[0.22em] text-neon-cyan/90">
              RAG System &amp; Agentic AI Workflow
            </p>
            <div className="mt-4 flex items-center justify-center gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Shield className="h-3 w-3 text-neon-purple" /> Private</span>
              <span className="text-neon-pink/50">·</span>
              <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3 text-neon-cyan" /> Agentic</span>
              <span className="text-neon-pink/50">·</span>
              <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3 text-neon-yellow" /> Zero-Hallucination</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 grid grid-cols-2 rounded-xl border border-border bg-secondary/40 p-1">
            {(["signin", "signup"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`relative rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                  mode === m ? "text-foreground" : "text-muted-foreground hover:text-foreground/80"
                }`}
              >
                {mode === m && (
                  <motion.span
                    layoutId="auth-tab"
                    className="absolute inset-0 rounded-lg border border-neon-pink/40 bg-neon-pink/10"
                    style={{ boxShadow: "0 0 18px hsl(330 100% 62% / 0.35)" }}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative">{m === "signin" ? "Sign In" : "Sign Up"}</span>
              </button>
            ))}
          </div>

          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={busy}
            className="group flex w-full items-center justify-center gap-3 rounded-xl border border-neon-cyan/40 bg-secondary/40 px-4 py-3 text-sm font-semibold text-foreground transition-all hover:border-neon-cyan hover:bg-neon-cyan/10 disabled:opacity-50"
            style={{ boxShadow: "0 0 18px hsl(185 100% 50% / 0.18)" }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-neon-pink/30 to-transparent" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">or email</span>
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-neon-cyan/30 to-transparent" />
          </div>

          {/* Form */}
          <form onSubmit={handleEmail} className="space-y-3">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neon-pink/70" />
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full rounded-xl border border-neon-pink/30 bg-secondary/40 py-3 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-all focus:border-neon-pink focus:bg-secondary/60"
                style={{ boxShadow: "inset 0 0 12px hsl(330 100% 62% / 0.08)" }}
              />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neon-purple/70" />
              <input
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-neon-purple/30 bg-secondary/40 py-3 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-all focus:border-neon-purple focus:bg-secondary/60"
                style={{ boxShadow: "inset 0 0 12px hsl(280 100% 65% / 0.08)" }}
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-neon-pink/60 bg-gradient-to-r from-neon-pink/30 via-neon-purple/30 to-neon-cyan/30 px-4 py-3 text-sm font-bold uppercase tracking-wider text-foreground transition-all hover:from-neon-pink/50 hover:via-neon-purple/50 hover:to-neon-cyan/50 disabled:opacity-50"
              style={{ boxShadow: "0 0 24px hsl(330 100% 62% / 0.45)" }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {mode === "signup" ? "Create Account" : "Enter Nexus"}
            </button>
          </form>

          <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Each session is private · Row-level isolation enforced
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.3 29 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.7 0 19.5-7.7 19.5-19.5 0-1.2-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.8 29 5 24 5 16.3 5 9.7 9 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 43c4.9 0 9.4-1.8 12.8-4.9l-5.9-5c-1.9 1.3-4.3 2.1-6.9 2.1-5.3 0-9.7-3-11.3-7.1l-6.5 5C9.6 39 16.2 43 24 43z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.1-2.1 3.9-3.8 5.2l5.9 5c3.5-3.2 5.6-7.9 5.6-13.7 0-1.2-.1-2.3-.4-3.5z"/>
    </svg>
  );
}