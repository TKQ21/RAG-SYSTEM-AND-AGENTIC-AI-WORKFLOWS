import { useState, useCallback, useEffect } from "react";
import type { ChatMessage, AgentStep, AgentMode, UploadedDocument } from "@/types/agent";
import { toast } from "sonner";
import { extractDocumentWithImages } from "@/lib/documentText";
import { supabase } from "@/integrations/supabase/client";

const generateId = () => Math.random().toString(36).slice(2, 10);

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-chat`;
const PROCESS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-document`;
const FOLLOWUPS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-followups`;

function getSessionId(userId: string | null): string {
  const key = userId ? `rag_session_id_${userId}` : "rag_session_id";
  // Persist across browser sessions so chat history isn't lost until user deletes it
  let sid = localStorage.getItem(key);
  if (!sid) { sid = generateId() + generateId(); localStorage.setItem(key, sid); }
  return sid;
}

async function getAuthHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return `Bearer ${token}`;
}

export function useAgentChat(userId: string | null, spaceId: string | null = null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentSteps, setCurrentSteps] = useState<AgentStep[]>([]);
  const [mode, setMode] = useState<AgentMode>("documents");
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [totalQueries, setTotalQueries] = useState(0);
  const [sessionId, setSessionId] = useState(() => getSessionId(userId));
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => { setSessionId(getSessionId(userId)); }, [userId]);

  // Load chat history + documents on mount (per user, RLS scoped)
  useEffect(() => {
    if (!userId) {
      setMessages([]);
      setDocuments([]);
      setTotalChunks(0);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("chat_history")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
        .limit(20);
      if (data && data.length > 0) {
        setMessages(data.map((m: any) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.message,
          timestamp: new Date(m.created_at).getTime(),
        })));
      } else {
        setMessages([]);
      }
    })();
    (async () => {
      let query = supabase
        .from("documents")
        .select("id, name, mime_type, size, chunk_count, created_at, space_id");
      // Multi-domain: when a knowledge space is selected, only its documents are visible.
      query = spaceId ? query.eq("space_id", spaceId) : query.is("space_id", null);
      const { data } = await query.order("created_at", { ascending: false });
      if (data) {
        setDocuments(data.map((d: any) => ({
          id: d.id,
          name: d.name,
          type: d.mime_type || "application/octet-stream",
          size: d.size || 0,
          chunks: d.chunk_count || 0,
          uploadedAt: new Date(d.created_at).getTime(),
        })));
        setTotalChunks(data.reduce((s: number, d: any) => s + (d.chunk_count || 0), 0));
        // Default active document = most recently uploaded (first, since desc order).
        if (data.length > 0) setActiveDocumentId(data[0].id);
        else setActiveDocumentId(null);
      } else {
        setDocuments([]);
        setTotalChunks(0);
        setActiveDocumentId(null);
      }
    })();
  }, [sessionId, userId, spaceId]);

  const addStep = useCallback((step: Omit<AgentStep, "id" | "timestamp">) => {
    const fullStep: AgentStep = { ...step, id: generateId(), timestamp: Date.now() };
    setCurrentSteps((prev) => [...prev, fullStep]);
    return fullStep.id;
  }, []);

  const updateStep = useCallback((id: string, updates: Partial<AgentStep>) => {
    setCurrentSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (isProcessing || !content.trim()) return;

    const userMsg: ChatMessage = { id: generateId(), role: "user", content: content.trim(), timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setIsProcessing(true);
    setCurrentSteps([]);
    setTotalQueries((q) => q + 1);
    setSuggestions([]);
    const startedAt = Date.now();

    const thinkId = addStep({ type: "thinking", label: "Analyzing query intent", status: "running" });

    try {
      await new Promise((r) => setTimeout(r, 200));
      updateStep(thinkId, { status: "done" });

      if (mode === "documents") {
        const searchId = addStep({ type: "search", label: "Semantic search across document chunks", status: "running" });
        await new Promise((r) => setTimeout(r, 100));
        updateStep(searchId, { status: "done" });
      }

      const analyzeId = addStep({ type: "analyze", label: "Generating response with AI", detail: "gemini-2.5-flash", status: "running" });

      const apiMessages = messages.concat(userMsg).map((m) => ({ role: m.role, content: m.content }));

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: await getAuthHeader() },
        body: JSON.stringify({ messages: apiMessages, mode, sessionId, activeDocumentId, spaceId }),
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
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
                }
                return [...prev, { id: "streaming", role: "assistant", content: assistantContent, timestamp: Date.now() }];
              });
            }
          } catch { textBuffer = line + "\n" + textBuffer; break; }
        }
      }

      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try { const p = JSON.parse(jsonStr); const d = p.choices?.[0]?.delta?.content; if (d) assistantContent += d; } catch {}
        }
      }

      updateStep(resultId, { status: "done" });
      setMessages((prev) => prev.map((m) => m.id === "streaming" ? { ...m, id: generateId() } : m));

      // Analytics log for the admin dashboard (best-effort, never blocks the answer).
      if (userId) {
        supabase
          .from("search_logs")
          .insert({
            user_id: userId,
            space_id: spaceId,
            session_id: sessionId,
            mode,
            query: content.trim().slice(0, 2000),
            results_count: assistantContent ? 1 : 0,
            latency_ms: Date.now() - startedAt,
            success: true,
          })
          .then(({ error }) => { if (error) console.error("search log failed", error.message); });
      }

      // Suggested follow-up questions, grounded in the answer that was just produced.
      if (assistantContent.trim().length > 40) {
        (async () => {
          try {
            const r = await fetch(FOLLOWUPS_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: await getAuthHeader() },
              body: JSON.stringify({ question: content.trim(), answer: assistantContent, mode }),
            });
            if (!r.ok) return;
            const json = await r.json();
            if (Array.isArray(json.suggestions)) setSuggestions(json.suggestions.slice(0, 3));
          } catch { /* suggestions are optional */ }
        })();
      }
    } catch (e) {
      console.error("Chat error:", e);
      const errorMsg: ChatMessage = { id: generateId(), role: "assistant", content: `⚠️ Error: ${e instanceof Error ? e.message : "Something went wrong"}. Please try again.`, timestamp: Date.now() };
      setMessages((prev) => [...prev, errorMsg]);
      if (userId) {
        supabase
          .from("search_logs")
          .insert({
            user_id: userId,
            space_id: spaceId,
            session_id: sessionId,
            mode,
            query: content.trim().slice(0, 2000),
            results_count: 0,
            latency_ms: Date.now() - startedAt,
            success: false,
          })
          .then(({ error }) => { if (error) console.error("search log failed", error.message); });
      }
    } finally {
      setIsProcessing(false);
      setCurrentSteps([]);
    }
  }, [isProcessing, messages, mode, addStep, updateStep, sessionId, activeDocumentId, spaceId, userId]);

  const uploadDocument = useCallback(async (file: File) => {
    const docId = generateId();
    const doc: UploadedDocument = { id: docId, name: file.name, type: file.type, size: file.size, uploadedAt: Date.now(), chunks: 0 };
    setDocuments((prev) => [...prev, doc]);

    try {
      const { text, pageImages, isImageHeavy, pdfBase64, pageCount } = await extractDocumentWithImages(file);
      toast.info(`Processing "${file.name}"${isImageHeavy ? " with AI Vision..." : "..."}`);

      const body: any = {
        documentName: file.name,
        documentText: text,
        mimeType: file.type,
        fileSize: file.size,
        pageCount,
        spaceId,
      };

      // Send raw PDF only for text-poor/scanned PDFs; this lets backend Gemini Vision OCR all pages
      // without forcing slow canvas uploads for normal text-based PDFs.
      if (isImageHeavy && pdfBase64) {
        body.pdfBase64 = pdfBase64;
      }
      if (pageImages.length > 0) {
        body.pageImages = pageImages.slice(0, 16);
      }

      const resp = await fetch(PROCESS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: await getAuthHeader() },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Processing failed" }));
        throw new Error(err.error || "Processing failed");
      }

      const result = await resp.json();
      setDocuments((prev) => prev.map((d) => d.id === docId ? { ...d, id: result.documentId || d.id, chunks: result.chunkCount } : d));
      setTotalChunks((c) => c + result.chunkCount);
      // The newly uploaded document becomes the active/preferred document for follow-up questions.
      if (result.documentId) setActiveDocumentId(result.documentId);
      toast.success(`"${file.name}" processed: ${result.chunkCount} chunks stored`);
    } catch (e) {
      console.error("Upload error:", e);
      toast.error(`Failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    }
  }, [spaceId]);

  const removeDocument = useCallback(async (id: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    setActiveDocumentId((cur) => (cur === id ? null : cur));
    // Cascade-style delete via RLS: remove chunks then document
    await supabase.from("document_chunks").delete().eq("document_id", id);
    await supabase.from("documents").delete().eq("id", id);
    let remainQuery = supabase.from("documents").select("chunk_count");
    remainQuery = spaceId ? remainQuery.eq("space_id", spaceId) : remainQuery.is("space_id", null);
    const { data } = await remainQuery;
    const remaining = (data || []).reduce((s: number, d: any) => s + (d.chunk_count || 0), 0);
    setTotalChunks(remaining);
    // Reset the queries counter when there are no documents left
    if (!data || data.length === 0) setTotalQueries(0);
  }, [spaceId]);

  const loadSession = useCallback(async (sid: string) => {
    const key = userId ? `rag_session_id_${userId}` : "rag_session_id";
    localStorage.setItem(key, sid);
    setSessionId(sid);
    setSuggestions([]);
    const { data } = await supabase
      .from("chat_history")
      .select("*")
      .eq("session_id", sid)
      .order("created_at", { ascending: true })
      .limit(50);
    if (data && data.length > 0) {
      setMessages(data.map((m: any) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.message,
        timestamp: new Date(m.created_at).getTime(),
      })));
    } else {
      setMessages([]);
    }
  }, [userId]);

  const newChat = useCallback(() => {
    const key = userId ? `rag_session_id_${userId}` : "rag_session_id";
    const fresh = generateId() + generateId();
    localStorage.setItem(key, fresh);
    setSessionId(fresh);
    setMessages([]);
    setCurrentSteps([]);
    setSuggestions([]);
    if (userId) {
      supabase
        .from("chat_sessions")
        .upsert({ user_id: userId, session_id: fresh, title: "New Chat" }, { onConflict: "user_id,session_id" })
        .then(({ error }) => { if (error) console.error("create session failed", error); });
    }
  }, [userId]);

  return { messages, isProcessing, currentSteps, mode, setMode, documents, sendMessage, uploadDocument, removeDocument, totalChunks, totalQueries, sessionId, loadSession, newChat, activeDocumentId, setActiveDocumentId, suggestions };
}
