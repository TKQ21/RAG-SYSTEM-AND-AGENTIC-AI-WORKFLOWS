export interface DomainPreset {
  id: string;
  label: string;
  accent: string;
}

/** Domain-agnostic presets — each becomes its own knowledge space using the same RAG engine. */
export const DOMAIN_PRESETS: DomainPreset[] = [
  { id: "healthcare", label: "Healthcare", accent: "text-neon-cyan" },
  { id: "banking", label: "Banking", accent: "text-neon-yellow" },
  { id: "legal", label: "Legal", accent: "text-neon-purple" },
  { id: "education", label: "Education", accent: "text-neon-pink" },
  { id: "hr", label: "HR", accent: "text-neon-cyan" },
  { id: "finance", label: "Finance", accent: "text-neon-yellow" },
  { id: "insurance", label: "Insurance", accent: "text-neon-purple" },
  { id: "manufacturing", label: "Manufacturing", accent: "text-neon-pink" },
  { id: "retail", label: "Retail", accent: "text-neon-cyan" },
  { id: "it-docs", label: "IT Documentation", accent: "text-neon-purple" },
  { id: "general", label: "General", accent: "text-muted-foreground" },
];

export const ACCESS_LEVELS = ["viewer", "editor", "admin"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export function domainLabel(domain: string): string {
  return DOMAIN_PRESETS.find((d) => d.id === domain)?.label || domain;
}

export function domainAccent(domain: string): string {
  return DOMAIN_PRESETS.find((d) => d.id === domain)?.accent || "text-neon-cyan";
}
