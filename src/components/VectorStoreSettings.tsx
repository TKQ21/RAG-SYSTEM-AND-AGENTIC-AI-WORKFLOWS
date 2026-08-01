import { useEffect, useState } from "react";
import { Database, Check, KeyRound } from "lucide-react";
import { toast } from "sonner";

export type VectorProvider = "pgvector" | "pinecone" | "qdrant" | "chroma" | "faiss" | "milvus";

interface ProviderInfo {
  id: VectorProvider;
  label: string;
  detail: string;
  needsKey: boolean;
}

const PROVIDERS: ProviderInfo[] = [
  { id: "pgvector", label: "pgvector (built-in)", detail: "768-dim HNSW index inside your own database. Active now.", needsKey: false },
  { id: "pinecone", label: "Pinecone", detail: "Managed serverless index. Needs API key + index name.", needsKey: true },
  { id: "qdrant", label: "Qdrant", detail: "Qdrant Cloud or self-hosted. Needs URL + API key.", needsKey: true },
  { id: "chroma", label: "Chroma", detail: "Needs a reachable Chroma server URL.", needsKey: true },
  { id: "faiss", label: "FAISS", detail: "In-process index — requires a Python service you host.", needsKey: true },
  { id: "milvus", label: "Milvus", detail: "Milvus/Zilliz cluster. Needs URI + token.", needsKey: true },
];

const STORAGE_KEY = "nexus_vector_provider";

export function VectorStoreSettings() {
  const [selected, setSelected] = useState<VectorProvider>("pgvector");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as VectorProvider | null;
    if (saved) setSelected(saved);
  }, []);

  const choose = (provider: ProviderInfo) => {
    setSelected(provider.id);
    localStorage.setItem(STORAGE_KEY, provider.id);
    if (provider.needsKey) {
      toast.info(`${provider.label} selected — credentials required before queries route there. pgvector stays active meanwhile.`);
    } else {
      toast.success("pgvector is active for retrieval.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-neon-cyan" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-neon-cyan">Vector Database</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Retrieval currently runs on pgvector with hybrid (vector + keyword) scoring. Selecting an external store records
        your preference; it becomes live once its credentials are stored as backend secrets.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {PROVIDERS.map((p) => {
          const active = selected === p.id;
          return (
            <button
              key={p.id}
              onClick={() => choose(p)}
              className={`rounded-xl border p-3 text-left transition-all ${
                active
                  ? "border-neon-cyan/60 bg-neon-cyan/10 shadow-[0_0_18px_hsl(185_100%_50%/0.25)]"
                  : "border-border bg-secondary/30 hover:border-neon-cyan/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">{p.label}</span>
                {active && <Check className="h-3.5 w-3.5 text-neon-cyan" />}
                {p.needsKey && <KeyRound className="ml-auto h-3 w-3 text-neon-yellow/70" />}
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{p.detail}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}