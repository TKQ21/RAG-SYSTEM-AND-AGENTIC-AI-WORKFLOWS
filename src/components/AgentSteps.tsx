import { motion } from "framer-motion";
import { Brain, Search, Code, BarChart3, CheckCircle2, Loader2, AlertCircle, Wrench } from "lucide-react";
import type { AgentStep } from "@/types/agent";

const STEP_ICONS: Record<AgentStep["type"], React.ElementType> = {
  thinking: Brain,
  search: Search,
  tool: Wrench,
  analyze: BarChart3,
  code: Code,
  result: CheckCircle2,
};

const STEP_COLORS: Record<AgentStep["type"], string> = {
  thinking: "text-neon-blue",
  search: "text-neon-green",
  tool: "text-neon-cyan",
  analyze: "text-neon-red",
  code: "text-neon-purple",
  result: "text-neon-green",
};

interface AgentStepsProps {
  steps: AgentStep[];
}

export function AgentSteps({ steps }: AgentStepsProps) {
  if (steps.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {steps.map((step, i) => {
        const Icon = STEP_ICONS[step.type];
        const colorClass = STEP_COLORS[step.type];

        return (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-2 rounded-md bg-secondary/50 px-3 py-1.5 font-mono text-xs"
          >
            {step.status === "running" ? (
              <Loader2 className={`h-3.5 w-3.5 animate-spin ${colorClass}`} />
            ) : step.status === "error" ? (
              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            ) : (
              <Icon className={`h-3.5 w-3.5 ${colorClass}`} />
            )}
            <span className="text-muted-foreground">{step.label}</span>
            {step.detail && (
              <span className="ml-auto text-muted-foreground/60">{step.detail}</span>
            )}
            {step.status === "done" && (
              <CheckCircle2 className="ml-auto h-3 w-3 text-neon-green/70" />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
