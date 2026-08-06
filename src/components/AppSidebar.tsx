import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Brain, Cpu, FileSearch, Database, Search, Shield, BarChart3, FlaskConical, CheckCircle2, History, Sparkles, X, Plus, Gauge } from "lucide-react";
import { ModeSelector } from "./ModeSelector";
import { DocumentPanel } from "./DocumentPanel";
import { SpaceSelector } from "./SpaceSelector";
import type { AgentMode, UploadedDocument } from "@/types/agent";
import type { KnowledgeSpace } from "@/hooks/useSpaces";

const PIPELINE_STEPS = [
  { icon: FileSearch, label: "Ingestion", desc: "OCR & Parse all pages", color: "text-neon-cyan" },
  { icon: Database, label: "Indexing", desc: "Chunk & Embed to Vector DB", color: "text-neon-cyan" },
  { icon: Search, label: "Query Analyst", desc: "Intent detection & decomposition", color: "text-neon-purple" },
  { icon: Shield, label: "Hybrid Retrieval", desc: "Vector + BM25 keyword search", color: "text-neon-cyan" },
  { icon: BarChart3, label: "Reranker", desc: "Cross-encoder merge & score", color: "text-neon-pink" },
  { icon: FlaskConical, label: "LLM Reasoning", desc: "Gemini/GPT analysis", color: "text-neon-purple" },
  { icon: Brain, label: "Research Agent", desc: "Sub-query decomposition", color: "text-neon-cyan" },
  { icon: CheckCircle2, label: "Validator", desc: "Anti-hallucination check", color: "text-neon-purple" },
];

interface SidebarProps {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  documents: UploadedDocument[];
  onUpload: (file: File) => void;
  onRemoveDoc: (id: string) => void;
  totalChunks: number;
  totalQueries: number;
  onOpenHistory?: () => void;
  onNewChat?: () => void;
  onCloseMobile?: () => void;
  spaces?: KnowledgeSpace[];
  activeSpaceId?: string | null;
  onSelectSpace?: (id: string | null) => void;
  /** Admins get upload + dashboard controls; normal users only chat. */
  isAdmin?: boolean;
}

const STAT_STYLES = [
  { label: "Documents", border: "border-neon-pink/40", text: "text-neon-pink", glow: "0 0 14px hsl(330 100% 62% / 0.18)" },
  { label: "Pages", border: "border-neon-purple/40", text: "text-neon-purple", glow: "0 0 14px hsl(280 100% 65% / 0.18)" },
  { label: "Chunks", border: "border-neon-cyan/40", text: "text-neon-cyan", glow: "0 0 14px hsl(185 100% 50% / 0.18)" },
  { label: "Queries", border: "border-neon-yellow/40", text: "text-neon-yellow", glow: "0 0 14px hsl(48 100% 60% / 0.18)" },
];

export function AppSidebar({ mode, onModeChange, documents, onUpload, onRemoveDoc, totalChunks, totalQueries, onOpenHistory, onNewChat, onCloseMobile, spaces = [], activeSpaceId = null, onSelectSpace, isAdmin = false }: SidebarProps) {
  const statValues = [
    documents.length,
    documents.reduce((s, d) => s + (d.chunks || 0), 0),
    documents.length === 0 ? 0 : totalChunks,
    totalQueries,
  ];
  return (
    <aside className="flex h-full w-80 max-w-[85vw] shrink-0 flex-col border-r border-neon-pink/20 bg-sidebar overflow-hidden"
      style={{ boxShadow: "inset -1px 0 18px hsl(330 100% 62% / 0.08)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-neon-pink/20 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-neon-pink/40 bg-secondary/50"
          style={{ boxShadow: "0 0 18px hsl(330 100% 62% / 0.4)" }}>
          <Brain className="h-5 w-5 text-neon-pink" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xs font-black uppercase tracking-wider text-foreground">RAG System & Agentic AI Workflow</h1>
          <p className="font-mono text-[10px] text-muted-foreground">Agentic Intelligence · Zero Hallucination</p>
        </div>
        <button onClick={onNewChat} className="rounded-lg border border-neon-cyan/30 p-2 text-neon-cyan/80 hover:bg-neon-cyan/10 hover:text-neon-cyan transition-all" style={{ boxShadow: "0 0 10px hsl(185 100% 50% / 0.25)" }} title="New Chat">
          <Plus className="h-4 w-4" />
        </button>
        <button onClick={onOpenHistory} className="rounded-lg border border-neon-pink/30 p-2 text-neon-pink/80 hover:bg-neon-pink/10 hover:text-neon-pink transition-all" style={{ boxShadow: "0 0 10px hsl(330 100% 62% / 0.2)" }} title="Chat History">
          <History className="h-4 w-4" />
        </button>
        {onCloseMobile && (
          <button onClick={onCloseMobile} className="md:hidden rounded-lg border border-neon-pink/30 p-2 text-neon-pink/80 hover:bg-neon-pink/10 hover:text-neon-pink transition-all" title="Close">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Badges */}
      <div className="flex gap-1.5 border-b border-neon-pink/10 px-4 py-2">
        {["AGENTIC", "MULTI-MODE", "ZERO HALLUCINATION"].map((b) => (
          <span key={b} className="rounded border border-border bg-secondary/50 px-2 py-0.5 font-mono text-[9px] text-muted-foreground">{b}</span>
        ))}
      </div>

      {/* Knowledge space switcher (multi-domain) */}
      {onSelectSpace && (
        <SpaceSelector spaces={spaces} activeSpaceId={activeSpaceId} onSelect={onSelectSpace} />
      )}

      {/* Admin-only entry point — knowledge sources & spaces live inside the dashboard */}
      {isAdmin && (
        <div className="border-b border-neon-pink/10 px-4 py-2">
          <Link
            to="/admin"
            className="flex items-center gap-2 rounded-lg border border-neon-purple/30 bg-neon-purple/5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-neon-purple transition-all hover:bg-neon-purple/10"
          >
            <Gauge className="h-3.5 w-3.5" />
            Admin Dashboard
          </Link>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 p-4">
          {STAT_STYLES.map((s, i) => (
            <div
              key={s.label}
              className={`rounded-xl border ${s.border} bg-secondary/30 p-2.5 text-center backdrop-blur-sm transition-transform hover:-translate-y-0.5`}
              style={{ boxShadow: s.glow }}
            >
              <div className={`text-lg font-bold ${s.text}`}>{statValues[i]}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Knowledge library — admins can upload, users only see what's indexed */}
        <div className="px-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-neon-pink" style={{ textShadow: "0 0 8px hsl(330 100% 62% / 0.5)" }}>
            {isAdmin ? "Upload Documents" : "Knowledge Library"}
          </h3>
          {isAdmin ? (
            <DocumentPanel documents={documents} onUpload={onUpload} onRemove={onRemoveDoc} />
          ) : documents.length === 0 ? (
            <p className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
              Is knowledge space me abhi kuch nahi hai. Admin documents aur sources add karta hai — aap sirf sawaal poochho.
            </p>
          ) : (
            <ul className="space-y-1">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-1.5">
                  <FileSearch className="h-3 w-3 shrink-0 text-neon-cyan" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/85">{d.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{d.chunks || 0}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pipeline */}
        <div className="px-4 pt-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-neon-pink" style={{ textShadow: "0 0 8px hsl(330 100% 62% / 0.5)" }}>
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
                  className={`h-2 w-2 rounded-full bg-neon-cyan`}
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

      {/* Status */}
      <div className="border-t border-neon-pink/20 p-3">
        <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2">
          <motion.div animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
            <Sparkles className="h-3.5 w-3.5 text-neon-cyan" />
          </motion.div>
          <span className="text-[10px] text-neon-cyan font-mono" style={{ textShadow: "0 0 6px hsl(185 100% 50% / 0.4)" }}>● ONLINE</span>
          <div className="ml-auto flex items-center gap-1">
            <Cpu className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground/50">v2.0</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
