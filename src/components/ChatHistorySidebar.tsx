import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Search, Trash2, X, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ChatSession {
  session_id: string;
  first_message: string;
  last_message_at: string;
  message_count: number;
}

interface ChatHistorySidebarProps {
  currentSessionId: string;
  onSelectSession: (sessionId: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function ChatHistorySidebar({ currentSessionId, onSelectSession, isOpen, onClose }: ChatHistorySidebarProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("chat_history")
        .select("session_id, message, created_at")
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(500);

      if (data) {
        const sessionMap = new Map<string, ChatSession>();
        for (const row of data) {
          if (!sessionMap.has(row.session_id)) {
            sessionMap.set(row.session_id, {
              session_id: row.session_id,
              first_message: row.message.slice(0, 80),
              last_message_at: row.created_at || "",
              message_count: 1,
            });
          } else {
            const s = sessionMap.get(row.session_id)!;
            s.message_count++;
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

  const deleteSession = async (sessionId: string) => {
    await supabase.from("chat_history").delete().eq("session_id", sessionId);
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
  };

  const filtered = sessions.filter((s) =>
    searchQuery ? s.first_message.toLowerCase().includes(searchQuery.toLowerCase()) : true
  );

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
          className="absolute left-0 top-0 z-50 flex h-full w-80 flex-col border-r border-neon-cyan/30 bg-card/95 backdrop-blur-md"
          style={{ boxShadow: "0 0 30px hsl(185 100% 50% / 0.15), 4px 0 20px hsl(0 0% 0% / 0.5)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neon-cyan/20 px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-neon-cyan" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Chat History</h2>
            </div>
            <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search */}
          <div className="border-b border-neon-cyan/10 p-3">
            <div
              className="flex items-center gap-2 rounded-lg border border-neon-cyan/20 bg-secondary/50 px-3 py-2 transition-all focus-within:border-neon-cyan/50"
              style={{ boxShadow: "inset 0 0 8px hsl(185 100% 50% / 0.05)" }}
            >
              <Search className="h-3.5 w-3.5 text-neon-cyan/60" />
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
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-neon-cyan border-t-transparent" />
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
                      ? "border-neon-cyan/40 bg-neon-cyan/10"
                      : "border-border/50 bg-secondary/20 hover:border-neon-cyan/20 hover:bg-secondary/40"
                  }`}
                  style={session.session_id === currentSessionId ? { boxShadow: "0 0 12px hsl(185 100% 50% / 0.1)" } : {}}
                  onClick={() => {
                    onSelectSession(session.session_id);
                    onClose();
                  }}
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neon-cyan/60" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{session.first_message}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Clock className="h-2.5 w-2.5 text-muted-foreground/60" />
                      <span className="text-[10px] text-muted-foreground/60">{formatTime(session.last_message_at)}</span>
                      <span className="text-[10px] text-muted-foreground/40">· {session.message_count} msgs</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(session.session_id); }}
                    className="shrink-0 rounded p-1 text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-neon-cyan/10 px-3 py-2">
            <p className="text-center text-[10px] text-muted-foreground/50 font-mono">
              {sessions.length} conversation{sessions.length !== 1 ? "s" : ""}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
