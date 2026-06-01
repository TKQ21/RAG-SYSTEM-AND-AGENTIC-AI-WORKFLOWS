import { motion } from "framer-motion";
import { FileSearch, FlaskConical, Globe } from "lucide-react";
import type { AgentMode } from "@/types/agent";

type ModeTheme = {
  value: AgentMode;
  label: string;
  icon: React.ElementType;
  description: string;
  text: string;
  border: string;
  bgActive: string;
  hex: string;
  glow: string;
  hoverGlow: string;
};

const MODES: ModeTheme[] = [
  {
    value: "documents",
    label: "Document",
    icon: FileSearch,
    description: "Query your uploaded docs",
    text: "text-neon-pink",
    border: "border-neon-pink/40",
    bgActive: "bg-neon-pink/10",
    hex: "hsl(330 100% 62%)",
    glow: "0 0 18px hsl(330 100% 62% / 0.45), inset 0 0 12px hsl(330 100% 62% / 0.12)",
    hoverGlow: "0 0 14px hsl(330 100% 62% / 0.35)",
  },
  {
    value: "datascience",
    label: "Data Science Helper",
    icon: FlaskConical,
    description: "Get ML/DS code & guidance",
    text: "text-neon-green",
    border: "border-neon-green/40",
    bgActive: "bg-neon-green/10",
    hex: "hsl(150 100% 45%)",
    glow: "0 0 18px hsl(150 100% 45% / 0.45), inset 0 0 12px hsl(150 100% 45% / 0.12)",
    hoverGlow: "0 0 14px hsl(150 100% 45% / 0.35)",
  },
  {
    value: "research",
    label: "Auto Research",
    icon: Globe,
    description: "Multi-step research analysis",
    text: "text-neon-red",
    border: "border-neon-red/40",
    bgActive: "bg-neon-red/10",
    hex: "hsl(350 100% 58%)",
    glow: "0 0 18px hsl(350 100% 58% / 0.5), inset 0 0 12px hsl(350 100% 58% / 0.14)",
    hoverGlow: "0 0 14px hsl(350 100% 58% / 0.4)",
  },
];

interface ModeSelectorProps {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
}

export function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Agent Mode
      </h3>
      <div className="grid grid-cols-1 gap-2">
        {MODES.map((m) => {
          const isActive = mode === m.value;
          return (
            <motion.button
              key={m.value}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.98 }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                if (!isActive) {
                  el.style.boxShadow = m.hoverGlow;
                  el.style.borderColor = m.hex;
                  el.dataset.hover = "1";
                }
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                if (!isActive) {
                  el.style.boxShadow = "";
                  el.style.borderColor = "";
                  el.dataset.hover = "";
                }
              }}
              onClick={() => onModeChange(m.value)}
              style={isActive ? { boxShadow: m.glow } : undefined}
              className={`group relative flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 backdrop-blur-sm ${
                isActive ? `${m.border} ${m.bgActive}` : "border-border/60 bg-secondary/30"
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all ${
                  isActive ? `${m.border} ${m.bgActive}` : "border-border/60 bg-background/40"
                }`}
              >
                <m.icon
                  className={`h-4 w-4 transition-colors ${isActive ? m.text : "text-muted-foreground"}`}
                  style={!isActive ? { color: undefined } : undefined}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-xs font-semibold tracking-wide transition-colors ${isActive ? m.text : "text-foreground/80"}`}>
                  {m.label}
                </div>
                <div className="text-[10px] text-muted-foreground/70">{m.description}</div>
              </div>
              {isActive && (
                <span className={`h-1.5 w-1.5 rounded-full animate-pulse-neon`} style={{ backgroundColor: m.hex, boxShadow: `0 0 8px ${m.hex}` }} />
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
