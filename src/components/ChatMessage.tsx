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
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neon-pink/40 bg-secondary"
             style={{ boxShadow: "0 0 14px hsl(330 100% 62% / 0.35)" }}>
          <Bot className="h-4 w-4 text-neon-pink" />
        </div>
      )}

      <div className={`max-w-[75%] space-y-2 ${isUser ? "items-end" : ""}`}>
        {message.steps && message.steps.length > 0 && (
          <AgentSteps steps={message.steps} />
        )}

        <div
          className={`group relative rounded-2xl px-4 py-3 text-sm leading-relaxed backdrop-blur-md transition-all duration-300 ${
            isUser
              ? "bg-gradient-to-br from-neon-pink/25 via-neon-red/15 to-transparent border border-neon-pink/50 text-foreground hover:border-neon-pink/80 hover:shadow-[0_0_28px_hsl(330_100%_62%/0.45)]"
              : "bg-gradient-to-br from-card/95 to-card/60 border border-neon-pink/15 text-card-foreground hover:border-neon-pink/45 hover:shadow-[0_0_24px_hsl(330_100%_62%/0.28)]"
          }`}
        >
          <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
               style={{ background: isUser
                 ? "radial-gradient(120% 80% at 50% 0%, hsl(330 100% 62% / 0.12), transparent 70%)"
                 : "radial-gradient(120% 80% at 50% 0%, hsl(330 100% 62% / 0.1), transparent 70%)" }} />
          <div className="prose-invert prose-sm max-w-none">
            <MessageContent content={message.content} />
          </div>
        </div>
      </div>

      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neon-pink/50 bg-secondary"
             style={{ boxShadow: "0 0 14px hsl(330 100% 62% / 0.4)" }}>
          <User className="h-4 w-4 text-neon-pink" />
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
