import { motion } from "framer-motion";
import { Brain, Cpu, Zap, FileSearch, Database, Search, Shield, BarChart3, FlaskConical, CheckCircle2, LogOut } from "lucide-react";
import { ModeSelector } from "./ModeSelector";
import { DocumentPanel } from "./DocumentPanel";
import type { AgentMode, UploadedDocument } from "@/types/agent";

const PIPELINE_STEPS = [
  { icon: FileSearch, label: "Ingestion", desc: "OCR & Parse all pages", color: "text-neon-cyan" },
  { icon: Database, label: "Indexing", desc: "Chunk & Embed to Vector DB", color: "text-neon-blue" },
  { icon: Search, label: "Query Analyst", desc: "Intent detection & decomposition", color: "text-neon-green" },
  { icon: Shield, label: "Hybrid Retrieval", desc: "Vector + BM25 keyword search", color: "text-neon-cyan" },
  { icon: BarChart3, label: "Reranker", desc: "Cross-encoder merge & score", color: "text-neon-red" },
  { icon: FlaskConical, label: "LLM Reasoning", desc: "Gemini/GPT analysis", color: "text-neon-purple" },
  { icon: Brain, label: "Research Agent", desc: "Sub-query decomposition", color: "text-neon-blue" },
  { icon: CheckCircle2, label: "Validator", desc: "Anti-hallucination check", color: "text-neon-green" },
];

interface SidebarProps {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  documents: UploadedDocument[];
  onUpload: (file: File) => void;
  onRemoveDoc: (id: string) => void;
  totalChunks: number;
  totalQueries: number;
  userEmail?: string;
  onLogout?: () => void;
  onOpenHistory?: () => void;
}

export function AppSidebar({ mode, onModeChange, documents, onUpload, onRemoveDoc, totalChunks, totalQueries, userEmail, onLogout }: SidebarProps) {
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-neon-cyan/20 bg-sidebar overflow-hidden"
      style={{ boxShadow: "inset -1px 0 15px hsl(185 100% 50% / 0.05)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-neon-cyan/20 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-neon-cyan/30 bg-secondary/50"
          style={{ boxShadow: "0 0 15px hsl(185 100% 50% / 0.2)" }}>
          <Brain className="h-5 w-5 text-neon-cyan" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xs font-black uppercase tracking-wider text-foreground">RAG System & Agentic AI Workflow</h1>
          <p className="font-mono text-[10px] font-bold text-neon-cyan" style={{ textShadow: "0 0 8px hsl(185 100% 50% / 0.5)" }}>[ NEXUS RAG ]</p>
        </div>
      </div>

      {/* Badges */}
      <div className="flex gap-1.5 border-b border-neon-cyan/10 px-4 py-2">
        {["AGENTIC", "MULTI-MODE", "ZERO HALLUCINATION"].map((b) => (
          <span key={b} className="rounded border border-border bg-secondary/50 px-2 py-0.5 font-mono text-[9px] text-muted-foreground">{b}</span>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 p-4">
          {[
            { label: "Documents", value: documents.length, color: "neon-cyan" },
            { label: "Pages", value: documents.reduce((s, d) => s + (d.chunks || 0), 0), color: "neon-blue" },
            { label: "Chunks", value: totalChunks, color: "neon-green" },
            { label: "Queries", value: totalQueries, color: "neon-purple" },
          ].map((s) => (
            <div key={s.label}
              className={`rounded-lg border border-${s.color}/30 bg-secondary/30 p-2.5 text-center`}
              style={{ boxShadow: `0 0 10px hsl(var(--${s.color}) / 0.1)` }}>
              <div className={`text-lg font-bold text-${s.color}`}>{s.value}</div>
              <div className="text-[10px] text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Upload */}
        <div className="px-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-neon-green" style={{ textShadow: "0 0 8px hsl(150 100% 45% / 0.4)" }}>
            Upload Documents
          </h3>
          <DocumentPanel documents={documents} onUpload={onUpload} onRemove={onRemoveDoc} />
        </div>

        {/* Pipeline */}
        <div className="px-4 pt-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-neon-cyan" style={{ textShadow: "0 0 8px hsl(185 100% 50% / 0.4)" }}>
            8-Agent Pipeline
          </h3>
          <div className="space-y-1">
            {PIPELINE_STEPS.map((step, i) => (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
              >
                <step.icon className={`h-4 w-4 ${step.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground">{step.label}</div>
                  <div className="text-[10px] text-muted-foreground/70">{step.desc}</div>
                </div>
                <motion.div
                  className={`h-2 w-2 rounded-full bg-neon-green`}
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 }}
                />
              </motion.div>
            ))}
          </div>
        </div>

        {/* Mode selector */}
        <div className="p-4">
          <ModeSelector mode={mode} onModeChange={onModeChange} />
        </div>
      </div>

      {/* User & status */}
      <div className="border-t border-neon-cyan/20 p-3 space-y-2">
        {userEmail && (
          <div className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2">
            <span className="truncate text-[11px] text-muted-foreground">{userEmail}</span>
            <button onClick={onLogout} className="text-muted-foreground hover:text-destructive transition-colors">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2">
          <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
            <Zap className="h-3.5 w-3.5 text-neon-green" />
          </motion.div>
          <span className="text-[10px] text-neon-green font-mono" style={{ textShadow: "0 0 6px hsl(150 100% 45% / 0.4)" }}>● LIVE</span>
          <div className="ml-auto flex items-center gap-1">
            <Cpu className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground/50">v2.0</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
