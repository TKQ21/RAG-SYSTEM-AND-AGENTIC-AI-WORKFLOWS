import { motion } from "framer-motion";
import { CornerDownRight, Lightbulb } from "lucide-react";

interface SuggestedQuestionsProps {
  suggestions: string[];
  onSelect: (question: string) => void;
  disabled?: boolean;
}

export function SuggestedQuestions({ suggestions, onSelect, disabled }: SuggestedQuestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="ml-11 rounded-xl border border-neon-cyan/25 bg-neon-cyan/5 p-3"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neon-cyan">
        <Lightbulb className="h-3 w-3" />
        Suggested follow-ups
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            disabled={disabled}
            onClick={() => onSelect(s)}
            className="flex items-center gap-1.5 rounded-full border border-neon-cyan/30 bg-background/50 px-3 py-1.5 text-left text-[11px] text-foreground/85 transition-all hover:border-neon-cyan/70 hover:text-neon-cyan disabled:opacity-50"
          >
            <CornerDownRight className="h-3 w-3 shrink-0 text-neon-cyan/70" />
            {s}
          </button>
        ))}
      </div>
    </motion.div>
  );
}