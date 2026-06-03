import { motion } from "framer-motion";
import { User, Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
          <MessageContent content={message.content} />
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
  return (
    <div className="markdown-body text-sm leading-relaxed text-card-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...p }) => <h1 className="mt-4 mb-2 text-base font-bold text-neon-pink" {...p} />,
          h2: ({ node, ...p }) => <h2 className="mt-4 mb-2 text-[15px] font-bold text-neon-pink" {...p} />,
          h3: ({ node, ...p }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold text-neon-pink/90" {...p} />,
          h4: ({ node, ...p }) => <h4 className="mt-2 mb-1 text-sm font-semibold text-foreground" {...p} />,
          p:  ({ node, ...p }) => <p className="my-1.5 whitespace-pre-wrap" {...p} />,
          strong: ({ node, ...p }) => <strong className="font-semibold text-foreground" {...p} />,
          em: ({ node, ...p }) => <em className="italic text-foreground/90" {...p} />,
          ul: ({ node, ...p }) => <ul className="my-2 ml-5 list-disc space-y-1 marker:text-neon-pink/70" {...p} />,
          ol: ({ node, ...p }) => <ol className="my-2 ml-5 list-decimal space-y-1 marker:text-neon-pink/70" {...p} />,
          li: ({ node, ...p }) => <li className="leading-relaxed" {...p} />,
          a:  ({ node, ...p }) => <a className="text-neon-cyan underline decoration-neon-cyan/40 hover:decoration-neon-cyan" target="_blank" rel="noreferrer" {...p} />,
          blockquote: ({ node, ...p }) => (
            <blockquote className="my-2 border-l-2 border-neon-pink/50 bg-neon-pink/5 px-3 py-1 text-foreground/80" {...p} />
          ),
          hr: () => <hr className="my-3 border-neon-pink/20" />,
          table: ({ node, ...p }) => (
            <div className="my-2 overflow-x-auto rounded-md border border-neon-pink/20">
              <table className="w-full text-xs" {...p} />
            </div>
          ),
          thead: ({ node, ...p }) => <thead className="bg-neon-pink/10 text-neon-pink" {...p} />,
          th: ({ node, ...p }) => <th className="border-b border-neon-pink/20 px-2 py-1.5 text-left font-semibold" {...p} />,
          td: ({ node, ...p }) => <td className="border-b border-neon-pink/10 px-2 py-1.5" {...p} />,
          code: ({ node, inline, className, children, ...rest }: any) => {
            if (inline) {
              return (
                <code className="rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-[12px] text-neon-cyan" {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code className={`font-mono text-[12px] text-neon-green/90 ${className || ""}`} {...rest}>
                {children}
              </code>
            );
          },
          pre: ({ node, ...p }) => (
            <pre className="my-2 overflow-x-auto rounded-lg border border-neon-pink/20 bg-[#0a0a14] p-3 text-[12px] leading-relaxed" {...p} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
