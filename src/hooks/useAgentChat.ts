import { useState, useCallback } from "react";
import type { ChatMessage, AgentStep, AgentMode, UploadedDocument } from "@/types/agent";

const generateId = () => Math.random().toString(36).slice(2, 10);

const MOCK_STEPS: Record<AgentMode, Omit<AgentStep, "id" | "timestamp" | "status">[]> = {
  documents: [
    { type: "thinking", label: "Analyzing query intent" },
    { type: "search", label: "Searching document embeddings", detail: "Top-k retrieval (k=5)" },
    { type: "analyze", label: "Scoring relevance of chunks" },
    { type: "result", label: "Generating answer from context" },
  ],
  datascience: [
    { type: "thinking", label: "Understanding data science query" },
    { type: "code", label: "Generating Python code snippet" },
    { type: "analyze", label: "Validating approach" },
    { type: "result", label: "Compiling response with explanation" },
  ],
  research: [
    { type: "thinking", label: "Decomposing research question" },
    { type: "search", label: "Searching across all sources" },
    { type: "tool", label: "Cross-referencing findings" },
    { type: "analyze", label: "Synthesizing insights" },
    { type: "result", label: "Generating structured report" },
  ],
};

const MOCK_RESPONSES: Record<AgentMode, string[]> = {
  documents: [
    "Based on the uploaded documents, I found relevant information across 3 chunks.\n\n**Key Findings:**\n- The document discusses transformer architectures and their application to NLP tasks\n- Section 3.2 specifically addresses attention mechanisms\n- The authors propose a novel multi-head attention variant\n\n```python\n# Relevant code from the paper\nclass MultiHeadAttention(nn.Module):\n    def __init__(self, d_model, n_heads):\n        super().__init__()\n        self.attention = ScaledDotProduct()\n```\n\n> *Source: uploaded_paper.pdf, pages 12-15*",
  ],
  datascience: [
    "Here's a complete approach for your data science task:\n\n**Step 1: Data Preprocessing**\n```python\nimport pandas as pd\nfrom sklearn.preprocessing import StandardScaler\n\ndf = pd.read_csv('data.csv')\nscaler = StandardScaler()\nX_scaled = scaler.fit_transform(df[features])\n```\n\n**Step 2: Model Training**\n```python\nfrom sklearn.ensemble import RandomForestClassifier\n\nmodel = RandomForestClassifier(n_estimators=100)\nmodel.fit(X_train, y_train)\nprint(f'Accuracy: {model.score(X_test, y_test):.4f}')\n```\n\n**Recommendation:** Use cross-validation with `cv=5` for more robust evaluation.",
  ],
  research: [
    "## Research Report: Analysis Complete\n\n### Summary\nAfter analyzing multiple sources, here are the consolidated findings:\n\n1. **Trend Analysis** — The field has seen a 340% increase in publications since 2020\n2. **Key Technologies** — RAG systems, vector databases, and agentic workflows dominate\n3. **Open Challenges** — Hallucination mitigation and context window limitations remain\n\n### Data Points\n| Metric | 2022 | 2023 | 2024 |\n|--------|------|------|------|\n| Papers Published | 1,200 | 3,400 | 5,800 |\n| Production Systems | 150 | 890 | 2,100 |\n\n### Recommendation\nFocus on hybrid retrieval approaches combining dense and sparse methods for optimal results.",
  ],
};

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentSteps, setCurrentSteps] = useState<AgentStep[]>([]);
  const [mode, setMode] = useState<AgentMode>("documents");
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);

  const simulateAgent = useCallback(async (userMessage: string) => {
    const steps = MOCK_STEPS[mode];
    const completedSteps: AgentStep[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step: AgentStep = {
        ...steps[i],
        id: generateId(),
        status: "running",
        timestamp: Date.now(),
      };
      completedSteps.push(step);
      setCurrentSteps([...completedSteps]);
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 600));
      completedSteps[i] = { ...completedSteps[i], status: "done" };
      setCurrentSteps([...completedSteps]);
    }

    return {
      steps: completedSteps,
      response: MOCK_RESPONSES[mode][0],
    };
  }, [mode]);

  const sendMessage = useCallback(async (content: string) => {
    if (isProcessing || !content.trim()) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: content.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);
    setCurrentSteps([]);

    try {
      const result = await simulateAgent(content);

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: result.response,
        steps: result.steps,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } finally {
      setIsProcessing(false);
      setCurrentSteps([]);
    }
  }, [isProcessing, simulateAgent]);

  const uploadDocument = useCallback((file: File) => {
    const doc: UploadedDocument = {
      id: generateId(),
      name: file.name,
      type: file.type,
      size: file.size,
      chunks: Math.floor(Math.random() * 20) + 5,
      uploadedAt: Date.now(),
    };
    setDocuments((prev) => [...prev, doc]);
  }, []);

  const removeDocument = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }, []);

  return {
    messages,
    isProcessing,
    currentSteps,
    mode,
    setMode,
    documents,
    sendMessage,
    uploadDocument,
    removeDocument,
  };
}
