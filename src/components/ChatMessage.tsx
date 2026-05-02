import { motion } from "framer-motion";
import { User, Bot } from "lucide-react";
import { AgentSteps } from "./AgentSteps";
import type { ChatMessage as ChatMessageType } from "@/types/agent";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary glow-blue">
          <Bot className="h-4 w-4 text-neon-blue" />
        </div>
      )}

      <div className={`max-w-[75%] space-y-2 ${isUser ? "items-end" : ""}`}>
        {message.steps && message.steps.length > 0 && (
          <AgentSteps steps={message.steps} />
        )}

        <div
          className={`group relative rounded-xl px-4 py-3 text-sm leading-relaxed backdrop-blur-sm transition-all duration-300 ${
            isUser
              ? "bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/40 text-foreground hover:border-primary/70 hover:shadow-[0_0_24px_hsl(210_100%_55%/0.35)]"
              : "bg-gradient-to-br from-card/95 to-card/70 border border-neon-cyan/20 text-card-foreground hover:border-neon-cyan/50 hover:shadow-[0_0_24px_hsl(185_100%_50%/0.3)]"
          }`}
        >
          <div className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
               style={{ background: isUser
                 ? "radial-gradient(120% 80% at 50% 0%, hsl(210 100% 55% / 0.08), transparent 70%)"
                 : "radial-gradient(120% 80% at 50% 0%, hsl(185 100% 50% / 0.08), transparent 70%)" }} />
          <div className="prose-invert prose-sm max-w-none">
            <MessageContent content={message.content} />
          </div>
        </div>
      </div>

      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-secondary"
             style={{ boxShadow: "0 0 12px hsl(210 100% 55% / 0.25)" }}>
          <User className="h-4 w-4 text-primary" />
        </div>
      )}
    </motion.div>
  );
}

function MessageContent({ content }: { content: string }) {
  // Simple markdown-like rendering
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*|\n)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const lines = part.slice(3, -3);
          const firstNewline = lines.indexOf("\n");
          const code = firstNewline > -1 ? lines.slice(firstNewline + 1) : lines;
          return (
            <pre key={i} className="my-2 overflow-x-auto rounded-md bg-secondary p-3 font-mono text-xs text-neon-green/90">
              <code>{code}</code>
            </pre>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-neon-cyan">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
        }
        if (part === "\n") return <br key={i} />;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
