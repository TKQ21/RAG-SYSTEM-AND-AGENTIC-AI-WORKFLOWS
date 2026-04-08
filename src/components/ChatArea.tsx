import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Sparkles } from "lucide-react";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { AgentSteps } from "./AgentSteps";
import type { ChatMessage as ChatMessageType, AgentStep, AgentMode } from "@/types/agent";

const MODE_LABELS: Record<AgentMode, string> = {
  documents: "Ask Documents",
  datascience: "DS Helper",
  research: "Auto Research",
};

const MODE_ICONS: Record<AgentMode, string> = {
  documents: "📄",
  datascience: "🧪",
  research: "🔍",
};

const PLACEHOLDERS: Record<AgentMode, string> = {
  documents: "Ask your documents anything...",
  datascience: "Describe your data science task...",
  research: "Enter a research question...",
};

interface ChatAreaProps {
  messages: ChatMessageType[];
  currentSteps: AgentStep[];
  isProcessing: boolean;
  mode: AgentMode;
  onSend: (message: string) => void;
}

export function ChatArea({ messages, currentSteps, isProcessing, mode, onSend }: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentSteps]);

  return (
    <div className="flex flex-1 flex-col">
      {/* Header tabs */}
      <div className="flex items-center justify-between border-b border-neon-cyan/20 px-6 py-2">
        <div className="flex items-center gap-4">
          {(["documents", "datascience", "research"] as AgentMode[]).map((m) => (
            <button
              key={m}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                mode === m
                  ? "bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              style={mode === m ? { boxShadow: "0 0 10px hsl(185 100% 50% / 0.15)" } : {}}
            >
              <span>{MODE_ICONS[m]}</span>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-neon-green/30 bg-secondary/50 px-3 py-1"
          style={{ boxShadow: "0 0 8px hsl(150 100% 45% / 0.15)" }}>
          <div className="h-1.5 w-1.5 rounded-full bg-neon-green animate-pulse-neon" />
          <span className="text-[10px] font-mono text-neon-green">LIVE</span>
        </div>
      </div>

      {/* Sub-header */}
      <div className="border-b border-border/50 px-6 py-1.5">
        <span className="text-[11px] text-muted-foreground">Query your uploaded documents</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 grid-bg relative">
        {/* Floating stars */}
        <div className="pointer-events-none absolute inset-0">
          {Array.from({ length: 30 }).map((_, i) => (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{
                width: Math.random() * 2 + 1,
                height: Math.random() * 2 + 1,
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                backgroundColor: i % 3 === 0 ? "hsl(45, 100%, 70%)" : i % 3 === 1 ? "hsl(185, 100%, 50%)" : "hsl(0, 0%, 100%)",
              }}
              animate={{ opacity: [0, 0.8, 0] }}
              transition={{ duration: 4 + Math.random() * 3, repeat: Infinity, delay: Math.random() * 5 }}
            />
          ))}
        </div>

        {messages.length === 0 ? (
          <EmptyState mode={mode} onSend={onSend} />
        ) : (
          <div className="relative z-10 mx-auto max-w-3xl space-y-6">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isProcessing && currentSteps.length > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neon-cyan/30 bg-secondary glow-cyan">
                  <Bot className="h-4 w-4 text-neon-cyan animate-pulse" />
                </div>
                <div className="max-w-[75%]">
                  <AgentSteps steps={currentSteps} />
                </div>
              </motion.div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-neon-cyan/20 p-4">
        <div className="mx-auto max-w-3xl">
          <ChatInput onSend={onSend} isProcessing={isProcessing} placeholder={PLACEHOLDERS[mode]} />
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border/30 px-6 py-2 text-center">
        <span className="text-[10px] text-muted-foreground">© 2026 <span className="font-semibold text-neon-cyan">Mohd Kaif</span> · Built with <span className="text-neon-red">AI</span> assistance</span>
      </div>
    </div>
  );
}

function EmptyState({ mode, onSend }: { mode: AgentMode; onSend: (msg: string) => void }) {
  const suggestions: Record<AgentMode, string[]> = {
    documents: [
      "Summarize key financial risks",
      "Is data retention policy mentioned?",
      "Compare Q1 vs Q2 performance",
      "What compliance gaps exist?",
    ],
    datascience: [
      "Write a random forest classifier with cross-validation",
      "How do I handle missing values in a time series?",
      "Explain L1 vs L2 regularization",
    ],
    research: [
      "What are the latest trends in RAG systems?",
      "Compare transformer architectures for NLP",
      "Analyze the state of MLOps in 2025",
    ],
  };

  return (
    <div className="relative z-10 flex h-full flex-col items-center justify-center">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
        <motion.div
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-neon-cyan/30 bg-secondary/50"
          style={{ boxShadow: "0 0 30px hsl(185 100% 50% / 0.2)" }}
          animate={{ boxShadow: ["0 0 20px hsl(185 100% 50% / 0.15)", "0 0 40px hsl(185 100% 50% / 0.3)", "0 0 20px hsl(185 100% 50% / 0.15)"] }}
          transition={{ duration: 3, repeat: Infinity }}
        >
          <Sparkles className="h-8 w-8 text-neon-cyan" />
        </motion.div>
        <h2 className="mb-1 text-lg font-bold text-neon-cyan" style={{ textShadow: "0 0 15px hsl(185 100% 50% / 0.4)" }}>
          RAG Intelligence Ready
        </h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Upload documents, then ask anything. Real AI-powered answers with citations and confidence scores.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {suggestions[mode].map((s, i) => (
            <motion.button
              key={s}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.1 }}
              onClick={() => onSend(s)}
              className="rounded-full border border-neon-cyan/30 bg-secondary/50 px-4 py-2 text-xs text-muted-foreground transition-all hover:border-neon-cyan/50 hover:text-foreground"
              style={{ boxShadow: "0 0 8px hsl(185 100% 50% / 0.08)" }}
            >
              {s}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
