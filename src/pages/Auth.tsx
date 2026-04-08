import { useState } from "react";
import { motion } from "framer-motion";
import { LogIn, UserPlus, Mail, Lock, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AuthProps {
  onAuth: () => void;
}

export default function Auth({ onAuth }: AuthProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success("Account created! You are now signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back!");
      }
      onAuth();
    } catch (err: any) {
      toast.error(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      {/* Animated stars background */}
      <div className="pointer-events-none absolute inset-0">
        {Array.from({ length: 60 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: Math.random() * 3 + 1,
              height: Math.random() * 3 + 1,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              backgroundColor: i % 3 === 0 ? "hsl(45, 100%, 70%)" : i % 3 === 1 ? "hsl(0, 0%, 100%)" : "hsl(185, 100%, 50%)",
            }}
            animate={{
              opacity: [0, 1, 0.3, 1, 0],
              scale: [0.5, 1, 0.8, 1, 0.5],
            }}
            transition={{
              duration: 3 + Math.random() * 4,
              repeat: Infinity,
              delay: Math.random() * 5,
            }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md px-4"
      >
        {/* Logo */}
        <div className="mb-8 text-center">
          <motion.div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-neon-cyan/40 bg-secondary/50"
            style={{ boxShadow: "0 0 30px hsl(185 100% 50% / 0.3), 0 0 60px hsl(185 100% 50% / 0.1)" }}
            animate={{ boxShadow: ["0 0 20px hsl(185 100% 50% / 0.2)", "0 0 40px hsl(185 100% 50% / 0.4)", "0 0 20px hsl(185 100% 50% / 0.2)"] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <Zap className="h-8 w-8 text-neon-cyan" />
          </motion.div>
          <h1 className="text-2xl font-black uppercase tracking-wider text-foreground">
            RAG System and Agentic
          </h1>
          <h1 className="text-2xl font-black uppercase tracking-wider text-neon-purple" style={{ textShadow: "0 0 20px hsl(270 100% 65% / 0.6)" }}>
            AI Workflow
          </h1>
          <p className="mt-1 font-mono text-lg font-bold text-neon-cyan" style={{ textShadow: "0 0 15px hsl(185 100% 50% / 0.6)" }}>
            [ NEXUS RAG ]
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Multi-Agent Document Intelligence Platform
          </p>
        </div>

        {/* Auth card */}
        <div
          className="rounded-xl border border-neon-cyan/30 bg-card/80 p-6 backdrop-blur-sm"
          style={{ boxShadow: "0 0 25px hsl(185 100% 50% / 0.15), inset 0 0 25px hsl(185 100% 50% / 0.05)" }}
        >
          {/* Tabs */}
          <div className="mb-6 flex rounded-lg border border-border bg-secondary/50 p-1">
            <button
              onClick={() => setIsSignUp(false)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-all ${
                !isSignUp
                  ? "bg-neon-cyan text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              style={!isSignUp ? { boxShadow: "0 0 15px hsl(185 100% 50% / 0.4)" } : {}}
            >
              <LogIn className="h-4 w-4" />
              Sign In
            </button>
            <button
              onClick={() => setIsSignUp(true)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2.5 text-sm font-medium transition-all ${
                isSignUp
                  ? "bg-neon-cyan text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              style={isSignUp ? { boxShadow: "0 0 15px hsl(185 100% 50% / 0.4)" } : {}}
            >
              <UserPlus className="h-4 w-4" />
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neon-green" style={{ textShadow: "0 0 8px hsl(150 100% 45% / 0.5)" }}>
                Email
              </label>
              <div
                className="flex items-center gap-2 rounded-lg border border-neon-cyan/30 bg-secondary/50 px-3 py-2.5"
                style={{ boxShadow: "inset 0 0 10px hsl(185 100% 50% / 0.05), 0 0 8px hsl(185 100% 50% / 0.1)" }}
              >
                <Mail className="h-4 w-4 text-neon-cyan/70" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-neon-green" style={{ textShadow: "0 0 8px hsl(150 100% 45% / 0.5)" }}>
                Password
              </label>
              <div
                className="flex items-center gap-2 rounded-lg border border-neon-cyan/30 bg-secondary/50 px-3 py-2.5"
                style={{ boxShadow: "inset 0 0 10px hsl(185 100% 50% / 0.05), 0 0 8px hsl(185 100% 50% / 0.1)" }}
              >
                <Lock className="h-4 w-4 text-neon-cyan/70" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </div>

            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-neon-cyan py-3 text-sm font-bold text-background transition-all disabled:opacity-50"
              style={{ boxShadow: "0 0 20px hsl(185 100% 50% / 0.4), 0 0 40px hsl(185 100% 50% / 0.2)" }}
            >
              <Zap className="h-4 w-4" />
              {loading ? "Processing..." : isSignUp ? "Sign Up" : "Sign In"}
            </motion.button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
