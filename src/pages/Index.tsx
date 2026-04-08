import { useState, useEffect } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { ChatArea } from "@/components/ChatArea";
import { ChatHistorySidebar } from "@/components/ChatHistorySidebar";
import { useAgentChat } from "@/hooks/useAgentChat";
import { supabase } from "@/integrations/supabase/client";
import { History } from "lucide-react";
import Auth from "@/pages/Auth";

const Index = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-cyan border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Auth onAuth={() => {}} />;
  }

  return <MainApp user={user} />;
};

function MainApp({ user }: { user: any }) {
  const {
    messages, isProcessing, currentSteps, mode, setMode,
    documents, sendMessage, uploadDocument, removeDocument,
    totalChunks, totalQueries, sessionId, loadSession,
  } = useAgentChat();

  const [historyOpen, setHistoryOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-background">
      <AppSidebar
        mode={mode}
        onModeChange={setMode}
        documents={documents}
        onUpload={uploadDocument}
        onRemoveDoc={removeDocument}
        totalChunks={totalChunks}
        totalQueries={totalQueries}
        userEmail={user.email}
        onLogout={handleLogout}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      {/* Chat history overlay */}
      <ChatHistorySidebar
        currentSessionId={sessionId}
        onSelectSession={(sid) => loadSession(sid)}
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      <ChatArea
        messages={messages}
        currentSteps={currentSteps}
        isProcessing={isProcessing}
        mode={mode}
        onSend={sendMessage}
      />
    </div>
  );
}

export default Index;
