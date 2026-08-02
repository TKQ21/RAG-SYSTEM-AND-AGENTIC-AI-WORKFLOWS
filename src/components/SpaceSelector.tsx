import { Link } from "react-router-dom";
import { Layers, Lock, Globe, Settings2 } from "lucide-react";
import { domainAccent, domainLabel } from "@/lib/spaces";
import type { KnowledgeSpace } from "@/hooks/useSpaces";

interface Props {
  spaces: KnowledgeSpace[];
  activeSpaceId: string | null;
  onSelect: (id: string | null) => void;
}

/** Multi-domain switcher: personal workspace + one entry per knowledge space. */
export function SpaceSelector({ spaces, activeSpaceId, onSelect }: Props) {
  return (
    <div className="border-b border-neon-pink/10 px-4 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-neon-purple">
          <Layers className="h-3 w-3" /> Knowledge Space
        </h3>
        <Link to="/spaces" className="text-neon-cyan/70 transition-colors hover:text-neon-cyan" title="Manage spaces & access">
          <Settings2 className="h-3.5 w-3.5" />
        </Link>
      </div>
      <select
        value={activeSpaceId ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
        className="w-full rounded-lg border border-neon-purple/30 bg-secondary/40 px-2.5 py-1.5 text-[11px] text-foreground outline-none focus:border-neon-purple/70"
        style={{ boxShadow: "0 0 10px hsl(280 100% 65% / 0.15)" }}
      >
        <option value="">Personal workspace</option>
        {spaces.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {domainLabel(s.domain)}
          </option>
        ))}
      </select>
      {activeSpaceId && (() => {
        const active = spaces.find((s) => s.id === activeSpaceId);
        if (!active) return null;
        const Icon = active.is_private ? Lock : Globe;
        return (
          <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground">
            <Icon className="h-3 w-3" />
            <span className={domainAccent(active.domain)}>{domainLabel(active.domain)}</span>
            <span>· {active.is_private ? "Private" : "Shared"}</span>
          </div>
        );
      })()}
    </div>
  );
}