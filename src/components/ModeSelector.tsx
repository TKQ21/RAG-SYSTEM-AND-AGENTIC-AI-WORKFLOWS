import { motion } from "framer-motion";
import { FileSearch, FlaskConical, Globe } from "lucide-react";
import type { AgentMode } from "@/types/agent";

const MODES: { value: AgentMode; label: string; icon: React.ElementType; color: string; description: string }[] = [
  {
    value: "documents",
    label: "Ask from Documents",
    icon: FileSearch,
    color: "text-neon-blue",
    description: "Query your uploaded docs",
  },
  {
    value: "datascience",
    label: "Data Science Helper",
    icon: FlaskConical,
    color: "text-neon-green",
    description: "Get ML/DS code & guidance",
  },
  {
    value: "research",
    label: "Auto Research Agent",
    icon: Globe,
    color: "text-neon-red",
    description: "Multi-step research analysis",
  },
];

interface ModeSelectorProps {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
}

export function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Agent Mode
      </h3>
      <div className="space-y-1.5">
        {MODES.map((m) => {
          const isActive = mode === m.value;
          return (
            <motion.button
              key={m.value}
              whileTap={{ scale: 0.98 }}
              onClick={() => onModeChange(m.value)}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all ${
                isActive
                  ? "border-primary/40 bg-primary/10 glow-blue"
                  : "border-border bg-secondary/30 hover:border-border hover:bg-secondary/60"
              }`}
            >
              <m.icon className={`h-4 w-4 shrink-0 ${isActive ? m.color : "text-muted-foreground"}`} />
              <div className="min-w-0">
                <div className={`text-xs font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                  {m.label}
                </div>
                <div className="text-[10px] text-muted-foreground/70">{m.description}</div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
