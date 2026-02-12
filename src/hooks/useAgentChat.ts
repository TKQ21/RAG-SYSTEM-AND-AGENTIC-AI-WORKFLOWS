import { useState, useCallback } from "react";
import type { ChatMessage, AgentStep, AgentMode, UploadedDocument } from "@/types/agent";

const generateId = () => Math.random().toString(36).slice(2, 10);

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`;

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentSteps, setCurrentSteps] = useState<AgentStep[]>([]);
  const [mode, setMode] = useState<AgentMode>("documents");
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [documentTexts, setDocumentTexts] = useState<Map<string, string>>(new Map());

  const addStep = useCallback((step: Omit<AgentStep, "id" | "timestamp">) => {
    const fullStep: AgentStep = { ...step, id: generateId(), timestamp: Date.now() };
    setCurrentSteps((prev) => [...prev, fullStep]);
    return fullStep.id;
  }, []);

  const updateStep = useCallback((id: string, updates: Partial<AgentStep>) => {
    setCurrentSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
  }, []);

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

    // Show thinking steps
    const thinkId = addStep({ type: "thinking", label: "Analyzing query intent", status: "running" });

    try {
      await new Promise((r) => setTimeout(r, 300));
      updateStep(thinkId, { status: "done" });

      // Build document context from extracted text
      let documentContext = "";
      if (mode === "documents" && documentTexts.size > 0) {
        const searchId = addStep({ type: "search", label: "Searching document embeddings", detail: `${documentTexts.size} docs`, status: "running" });
        await new Promise((r) => setTimeout(r, 200));
        documentContext = Array.from(documentTexts.entries())
          .map(([name, text]) => `--- Document: ${name} ---\n${text}`)
          .join("\n\n");
        updateStep(searchId, { status: "done" });
      }

      const analyzeId = addStep({ type: "analyze", label: "Processing with AI model", detail: "gemini-3-flash", status: "running" });

      // Build conversation history for context
      const apiMessages = messages
        .concat(userMsg)
        .map((m) => ({ role: m.role, content: m.content }));

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: apiMessages,
          mode,
          documentContext: documentContext || undefined,
        }),
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error(errorData.error || `Request failed (${resp.status})`);
      }

      updateStep(analyzeId, { status: "done" });
      const resultId = addStep({ type: "result", label: "Streaming response", status: "running" });

      // Stream the response
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let assistantContent = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) {
              assistantContent += delta;
              // Update the assistant message in real-time
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant" && last.id === "streaming") {
                  return prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, content: assistantContent } : m
                  );
                }
                return [
                  ...prev,
                  {
                    id: "streaming",
                    role: "assistant",
                    content: assistantContent,
                    timestamp: Date.now(),
                  },
                ];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Flush remaining buffer
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) assistantContent += delta;
          } catch { /* ignore */ }
        }
      }

      updateStep(resultId, { status: "done" });

      // Finalize the assistant message with steps
      const finalSteps = [...currentSteps];
      setMessages((prev) =>
        prev.map((m) =>
          m.id === "streaming"
            ? { ...m, id: generateId(), steps: finalSteps }
            : m
        )
      );
    } catch (e) {
      console.error("Chat error:", e);
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: `⚠️ Error: ${e instanceof Error ? e.message : "Something went wrong"}. Please try again.`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsProcessing(false);
      setCurrentSteps([]);
    }
  }, [isProcessing, messages, mode, documentTexts, addStep, updateStep, currentSteps]);

  const uploadDocument = useCallback(async (file: File) => {
    const doc: UploadedDocument = {
      id: generateId(),
      name: file.name,
      type: file.type,
      size: file.size,
      uploadedAt: Date.now(),
    };

    // Extract text from the file
    try {
      const text = await file.text();
      const truncated = text.slice(0, 50000); // Limit to ~50k chars for context window
      const chunks = Math.ceil(truncated.length / 1000);
      doc.chunks = chunks;

      setDocumentTexts((prev) => {
        const next = new Map(prev);
        next.set(file.name, truncated);
        return next;
      });
    } catch {
      doc.chunks = 0;
    }

    setDocuments((prev) => [...prev, doc]);
  }, []);

  const removeDocument = useCallback((id: string) => {
    setDocuments((prev) => {
      const doc = prev.find((d) => d.id === id);
      if (doc) {
        setDocumentTexts((prevTexts) => {
          const next = new Map(prevTexts);
          next.delete(doc.name);
          return next;
        });
      }
      return prev.filter((d) => d.id !== id);
    });
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
