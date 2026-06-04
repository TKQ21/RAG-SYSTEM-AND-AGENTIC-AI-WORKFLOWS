import { useState } from "react";
import { Menu, LogOut } from "lucide-react";
import { Navigate } from "react-router-dom";
import { AppSidebar } from "@/components/AppSidebar";
import { ChatArea } from "@/components/ChatArea";
import { ChatHistorySidebar } from "@/components/ChatHistorySidebar";
import { useAgentChat } from "@/hooks/useAgentChat";
import { IntroAnimation } from "@/components/IntroAnimation";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const Index = () => {
  const { user, loading } = useAuth();
  const [showIntro, setShowIntro] = useState(() => sessionStorage.getItem("intro_shown") !== "1");

  const handleIntroDone = () => {
    sessionStorage.setItem("intro_shown", "1");
    setShowIntro(false);
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-pink border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  return (
    <>
      {showIntro && <IntroAnimation onComplete={handleIntroDone} />}
      <MainApp userId={user.id} userEmail={user.email || ""} />
    </>
  );
};

function MainApp({ userId, userEmail }: { userId: string; userEmail: string }) {
  const {
    messages, isProcessing, currentSteps, mode, setMode,
    documents, sendMessage, uploadDocument, removeDocument,
    totalChunks, totalQueries, sessionId, loadSession,
  } = useAgentChat(userId);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
  };

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-background">
      {/* Mobile menu trigger */}
      <button
        onClick={() => setMobileSidebarOpen(true)}
        className="md:hidden fixed left-3 top-3 z-40 rounded-lg border border-neon-pink/40 bg-card/80 p-2 text-neon-pink backdrop-blur-md"
        style={{ boxShadow: "0 0 12px hsl(330 100% 62% / 0.3)" }}
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* User chip + sign out (desktop top-right) */}
      <div className="fixed right-3 top-3 z-40 flex items-center gap-2">
        <div
          className="hidden sm:flex items-center gap-2 rounded-lg border border-neon-cyan/40 bg-card/80 px-3 py-1.5 text-[11px] font-mono text-neon-cyan backdrop-blur-md"
          style={{ boxShadow: "0 0 10px hsl(185 100% 50% / 0.25)" }}
          title={userEmail}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-neon-cyan animate-pulse" />
          <span className="max-w-[160px] truncate">{userEmail}</span>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 rounded-lg border border-neon-pink/40 bg-card/80 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-neon-pink backdrop-blur-md transition-all hover:bg-neon-pink/10"
          style={{ boxShadow: "0 0 10px hsl(330 100% 62% / 0.3)" }}
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar (slide-in on mobile, fixed on desktop) */}
      <div
        className={`fixed md:relative z-50 h-full transition-transform duration-300 ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <AppSidebar
          mode={mode}
          onModeChange={setMode}
          documents={documents}
          onUpload={uploadDocument}
          onRemoveDoc={removeDocument}
          totalChunks={totalChunks}
          totalQueries={totalQueries}
          onOpenHistory={() => setHistoryOpen(true)}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />
      </div>

      {/* Chat history overlay */}
      <ChatHistorySidebar
        currentSessionId={sessionId}
        onSelectSession={(sid) => loadSession(sid)}
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />

      <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden">
        <ChatArea
          messages={messages}
          currentSteps={currentSteps}
          isProcessing={isProcessing}
          mode={mode}
          onSend={sendMessage}
        />
      </div>
    </div>
  );
}

export default Index;
