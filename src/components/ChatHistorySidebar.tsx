import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Search, Trash2, X, Clock, Pencil, Plus, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ChatSession {
  session_id: string;
  first_message: string;
  last_message_at: string;
  message_count: number;
  title?: string | null;
}

interface ChatHistorySidebarProps {
  currentSessionId: string;
  onSelectSession: (sessionId: string) => void;
  isOpen: boolean;
  onClose: () => void;
  onNewChat?: () => void;
}

export function ChatHistorySidebar({ currentSessionId, onSelectSession, isOpen, onClose, onNewChat }: ChatHistorySidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, { data: titleRows }] = await Promise.all([
        supabase
          .from("chat_history")
          .select("session_id, message, created_at")
          .eq("role", "user")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("chat_sessions")
          .select("session_id, title, updated_at")
          .order("updated_at", { ascending: false }),
      ]);

      const titleMap = new Map<string, string>();
      for (const t of titleRows || []) titleMap.set(t.session_id, t.title);

      if (data) {
        const sessionMap = new Map<string, ChatSession>();
        for (const row of data) {
          if (!sessionMap.has(row.session_id)) {
            sessionMap.set(row.session_id, {
              session_id: row.session_id,
              first_message: row.message.slice(0, 80),
              last_message_at: row.created_at || "",
              message_count: 1,
              title: titleMap.get(row.session_id) || null,
            });
          } else {
            const s = sessionMap.get(row.session_id)!;
            s.message_count++;
          }
        }
        // Include renamed/saved sessions that have no messages yet
        for (const t of titleRows || []) {
          if (!sessionMap.has(t.session_id)) {
            sessionMap.set(t.session_id, {
              session_id: t.session_id,
              first_message: "",
              last_message_at: t.updated_at || "",
              message_count: 0,
              title: t.title,
            });
          }
        }
        setSessions(Array.from(sessionMap.values()));
      }
    } catch (e) {
      console.error("Failed to load sessions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadSessions();
  }, [isOpen, loadSessions]);

  const startRename = (session: ChatSession) => {
    setEditingId(session.session_id);
    setEditValue(session.title || session.first_message || "New Chat");
    requestAnimationFrame(() => editInputRef.current?.focus());
  };

  const saveRename = async (sessionId: string) => {
    const title = editValue.trim();
    setEditingId(null);
    if (!title) return;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;
    const { error } = await supabase
      .from("chat_sessions")
      .upsert({ user_id: uid, session_id: sessionId, title }, { onConflict: "user_id,session_id" });
    if (error) {
      console.error("rename failed", error);
      return;
    }
    setSessions((prev) => prev.map((s) => (s.session_id === sessionId ? { ...s, title } : s)));
  };

  const deleteSession = async (sessionId: string) => {
    const { error } = await supabase.from("chat_history").delete().eq("session_id", sessionId);
    if (error) {
      console.error("delete session failed", error);
      return;
    }
    await supabase.from("chat_sessions").delete().eq("session_id", sessionId);
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
    // If user deleted the active session, start a fresh one and reload UI
    if (sessionId === currentSessionId) {
      const fresh = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const { data: auth } = await supabase.auth.getUser();
      const key = auth.user?.id ? `rag_session_id_${auth.user.id}` : "rag_session_id";
      localStorage.setItem(key, fresh);
      window.location.reload();
    }
  };

  const filtered = sessions.filter((s) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (s.title || "").toLowerCase().includes(q) || s.first_message.toLowerCase().includes(q);
  });

  const formatTime = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = diffMs / 3600000;
    if (diffH < 1) return `${Math.max(1, Math.floor(diffMs / 60000))}m ago`;
    if (diffH < 24) return `${Math.floor(diffH)}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: -300, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -300, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="absolute left-0 top-0 z-50 flex h-full w-80 max-w-[85vw] flex-col border-r border-neon-pink/30 bg-card/95 backdrop-blur-md"
          style={{ boxShadow: "0 0 30px hsl(330 100% 62% / 0.18), 4px 0 20px hsl(0 0% 0% / 0.5)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neon-pink/20 px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-neon-pink" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Chat History</h2>
            </div>
            <div className="flex items-center gap-1">
              {onNewChat && (
                <button
                  onClick={() => { onNewChat(); onClose(); }}
                  className="flex items-center gap-1 rounded-lg border border-neon-cyan/30 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neon-cyan hover:bg-neon-cyan/10 transition-colors"
                  title="New Chat"
                >
                  <Plus className="h-3.5 w-3.5" /> New
                </button>
              )}
              <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="border-b border-neon-pink/10 p-3">
            <div
              className="flex items-center gap-2 rounded-lg border border-neon-pink/20 bg-secondary/50 px-3 py-2 transition-all focus-within:border-neon-pink/50"
              style={{ boxShadow: "inset 0 0 8px hsl(330 100% 62% / 0.08)" }}
            >
              <Search className="h-3.5 w-3.5 text-neon-pink/70" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>

          {/* Sessions list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-neon-pink border-t-transparent" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                {searchQuery ? "No matching conversations" : "No chat history yet"}
              </div>
            ) : (
              filtered.map((session) => (
                <motion.div
                  key={session.session_id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`group flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition-all ${
                    session.session_id === currentSessionId
                      ? "border-neon-pink/50 bg-neon-pink/10"
                      : "border-border/50 bg-secondary/20 hover:border-neon-pink/30 hover:bg-secondary/40"
                  }`}
                  style={session.session_id === currentSessionId ? { boxShadow: "0 0 14px hsl(330 100% 62% / 0.18)" } : {}}
                  onClick={() => {
                    onSelectSession(session.session_id);
                    onClose();
                  }}
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neon-pink/70" />
                  <div className="min-w-0 flex-1">
                    {editingId === session.session_id ? (
                      <input
                        ref={editInputRef}
                        value={editValue}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); saveRename(session.session_id); }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onBlur={() => saveRename(session.session_id)}
                        className="w-full rounded border border-neon-cyan/40 bg-secondary/60 px-1.5 py-0.5 text-xs text-foreground focus:outline-none"
                      />
                    ) : (
                      <p className="truncate text-xs font-medium text-foreground">
                        {session.title || session.first_message || "New Chat"}
                      </p>
                    )}
                    <div className="mt-1 flex items-center gap-2">
                      <Clock className="h-2.5 w-2.5 text-muted-foreground/60" />
                      <span className="text-[10px] text-muted-foreground/60">{formatTime(session.last_message_at)}</span>
                      <span className="text-[10px] text-muted-foreground/40">· {session.message_count} msgs</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editingId === session.session_id) saveRename(session.session_id);
                        else startRename(session);
                      }}
                      title="Rename chat"
                      className="rounded p-1 text-muted-foreground/40 opacity-0 transition-all hover:bg-neon-cyan/20 hover:text-neon-cyan group-hover:opacity-100"
                    >
                      {editingId === session.session_id ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSession(session.session_id); }}
                      title="Delete chat"
                      className="rounded p-1 text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-neon-pink/10 px-3 py-2">
            <p className="text-center text-[10px] text-muted-foreground/50 font-mono">
              {sessions.length} conversation{sessions.length !== 1 ? "s" : ""}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
