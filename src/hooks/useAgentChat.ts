import { useState, useCallback } from "react";
import type { ChatMessage, AgentStep, AgentMode, UploadedDocument } from "@/types/agent";
import { toast } from "sonner";

const generateId = () => Math.random().toString(36).slice(2, 10);

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`;
const PROCESS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-document`;

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentSteps, setCurrentSteps] = useState<AgentStep[]>([]);
  const [mode, setMode] = useState<AgentMode>("documents");
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);

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

    const thinkId = addStep({ type: "thinking", label: "Analyzing query intent", status: "running" });

    try {
      await new Promise((r) => setTimeout(r, 200));
      updateStep(thinkId, { status: "done" });

      if (mode === "documents") {
        const searchId = addStep({ type: "search", label: "Semantic search across document chunks", status: "running" });
        await new Promise((r) => setTimeout(r, 100));
        updateStep(searchId, { status: "done" });
      }

      const analyzeId = addStep({ type: "analyze", label: "Generating response with AI", detail: "gemini-3-flash", status: "running" });

      const apiMessages = messages
        .concat(userMsg)
        .map((m) => ({ role: m.role, content: m.content }));

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: apiMessages, mode }),
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ error: "Request failed" }));
        throw new Error(errorData.error || `Request failed (${resp.status})`);
      }

      updateStep(analyzeId, { status: "done" });
      const resultId = addStep({ type: "result", label: "Streaming response", status: "running" });

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
          if (jsonStr === "[DONE]") { streamDone = true; break; }

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) {
              assistantContent += delta;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant" && last.id === "streaming") {
                  return prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, content: assistantContent } : m
                  );
                }
                return [...prev, { id: "streaming", role: "assistant", content: assistantContent, timestamp: Date.now() }];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Flush remaining
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

      setMessages((prev) =>
        prev.map((m) =>
          m.id === "streaming" ? { ...m, id: generateId() } : m
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
  }, [isProcessing, messages, mode, addStep, updateStep]);

  const uploadDocument = useCallback(async (file: File) => {
    const docId = generateId();
    const doc: UploadedDocument = {
      id: docId,
      name: file.name,
      type: file.type,
      size: file.size,
      uploadedAt: Date.now(),
      chunks: 0,
    };

    setDocuments((prev) => [...prev, doc]);

    try {
      // Extract text from file
      const text = await file.text();
      const truncated = text.slice(0, 100000); // 100k chars max

      toast.info(`Processing "${file.name}"...`);

      // Send to process-document edge function
      const resp = await fetch(PROCESS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          documentName: file.name,
          documentText: truncated,
          mimeType: file.type,
          fileSize: file.size,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Processing failed" }));
        throw new Error(err.error || "Processing failed");
      }

      const result = await resp.json();
      
      // Update document with chunk count
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId ? { ...d, chunks: result.chunkCount } : d
        )
      );

      toast.success(`"${file.name}" processed: ${result.chunkCount} chunks stored for semantic search`);
    } catch (e) {
      console.error("Upload error:", e);
      toast.error(`Failed to process "${file.name}": ${e instanceof Error ? e.message : "Unknown error"}`);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    }
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
