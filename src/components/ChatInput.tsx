import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Send, Loader2 } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  isProcessing: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, isProcessing, placeholder }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (!value.trim() || isProcessing) return;
    onSend(value);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 150) + "px";
    }
  };

  return (
    <div className="relative flex items-end gap-2 rounded-xl border border-neon-pink/30 bg-card/70 backdrop-blur-md p-2 transition-all duration-300 focus-within:neon-border-pink hover:border-neon-pink/60">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => { setValue(e.target.value); handleInput(); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || "Ask anything..."}
        rows={1}
        className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      <motion.button
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleSubmit}
        disabled={isProcessing || !value.trim()}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-neon-pink to-neon-red text-white shadow-[0_0_18px_hsl(330_100%_62%/0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-[0_0_28px_hsl(330_100%_62%/0.75)]"
      >
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </motion.button>
    </div>
  );
}
