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
          className={`rounded-lg px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-primary/15 border border-primary/30 text-foreground"
              : "bg-card border border-border text-card-foreground"
          }`}
        >
          <div className="prose-invert prose-sm max-w-none">
            <MessageContent content={message.content} />
          </div>
        </div>
      </div>

      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
          <User className="h-4 w-4 text-muted-foreground" />
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
