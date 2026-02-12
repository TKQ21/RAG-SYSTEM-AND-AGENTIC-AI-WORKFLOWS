import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Sparkles } from "lucide-react";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { AgentSteps } from "./AgentSteps";
import type { ChatMessage as ChatMessageType, AgentStep, AgentMode } from "@/types/agent";

const MODE_LABELS: Record<AgentMode, string> = {
  documents: "Ask from Documents",
  datascience: "Data Science Helper",
  research: "Auto Research Agent",
};

const PLACEHOLDERS: Record<AgentMode, string> = {
  documents: "Ask a question about your uploaded documents...",
  datascience: "Describe your data science task or ask for code...",
  research: "Enter a research question for multi-step analysis...",
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
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-neon-blue" />
          <span className="text-sm font-medium text-foreground">{MODE_LABELS[mode]}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-secondary/50 px-3 py-1">
          <div className="h-1.5 w-1.5 rounded-full bg-neon-green animate-pulse-neon" />
          <span className="text-[10px] font-mono text-muted-foreground">ONLINE</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 grid-bg">
        {messages.length === 0 ? (
          <EmptyState mode={mode} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            <AnimatePresence>
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))}
            </AnimatePresence>

            {/* Live agent steps */}
            {isProcessing && currentSteps.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary glow-blue">
                  <Bot className="h-4 w-4 text-neon-blue animate-pulse" />
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
      <div className="border-t border-border p-4">
        <div className="mx-auto max-w-3xl">
          <ChatInput onSend={onSend} isProcessing={isProcessing} placeholder={PLACEHOLDERS[mode]} />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ mode }: { mode: AgentMode }) {
  const suggestions: Record<AgentMode, string[]> = {
    documents: [
      "Summarize the key findings from my paper",
      "What methodology does the document describe?",
      "Find all references to neural networks",
    ],
    datascience: [
      "Write a random forest classifier with cross-validation",
      "How do I handle missing values in a time series?",
      "Explain the difference between L1 and L2 regularization",
    ],
    research: [
      "What are the latest trends in RAG systems?",
      "Compare transformer architectures for NLP tasks",
      "Analyze the state of MLOps in 2024",
    ],
  };

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center"
      >
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 glow-blue">
          <Bot className="h-8 w-8 text-neon-blue" />
        </div>
        <h2 className="mb-1 text-lg font-semibold text-foreground">
          {MODE_LABELS[mode]}
        </h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Start a conversation or try one of these:
        </p>
        <div className="flex flex-col gap-2">
          {suggestions[mode].map((s, i) => (
            <motion.button
              key={s}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.1 }}
              className="rounded-lg border border-border bg-card px-4 py-2.5 text-left text-xs text-muted-foreground transition-all hover:border-primary/30 hover:bg-secondary hover:text-foreground"
            >
              {s}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
