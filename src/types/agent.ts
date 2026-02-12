export type AgentMode = "documents" | "datascience" | "research";

export interface AgentStep {
  id: string;
  type: "thinking" | "tool" | "search" | "analyze" | "code" | "result";
  label: string;
  detail?: string;
  status: "running" | "done" | "error";
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps?: AgentStep[];
  timestamp: number;
}

export interface UploadedDocument {
  id: string;
  name: string;
  type: string;
  size: number;
  chunks?: number;
  uploadedAt: number;
}
