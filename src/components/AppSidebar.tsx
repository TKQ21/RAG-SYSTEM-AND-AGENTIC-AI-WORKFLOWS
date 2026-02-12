import { motion } from "framer-motion";
import { Brain, Cpu, Zap } from "lucide-react";
import { ModeSelector } from "./ModeSelector";
import { DocumentPanel } from "./DocumentPanel";
import type { AgentMode, UploadedDocument } from "@/types/agent";

interface SidebarProps {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  documents: UploadedDocument[];
  onUpload: (file: File) => void;
  onRemoveDoc: (id: string) => void;
}

export function AppSidebar({ mode, onModeChange, documents, onUpload, onRemoveDoc }: SidebarProps) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 glow-blue">
          <Brain className="h-5 w-5 text-neon-blue" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-foreground text-glow-blue">AgentRAG</h1>
          <p className="text-[10px] text-muted-foreground">AI Assistant for DS Engineers</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <ModeSelector mode={mode} onModeChange={onModeChange} />
        <div className="h-px bg-border" />
        <DocumentPanel documents={documents} onUpload={onUpload} onRemove={onRemoveDoc} />
      </div>

      {/* Status */}
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2">
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Zap className="h-3.5 w-3.5 text-neon-green" />
          </motion.div>
          <span className="text-[10px] text-muted-foreground">System Ready</span>
          <div className="ml-auto flex items-center gap-1">
            <Cpu className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground/50">v1.0</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
