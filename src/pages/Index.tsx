import { useState, useEffect } from "react";
import { Menu } from "lucide-react";
import { AppSidebar } from "@/components/AppSidebar";
import { ChatArea } from "@/components/ChatArea";
import { ChatHistorySidebar } from "@/components/ChatHistorySidebar";
import { useAgentChat } from "@/hooks/useAgentChat";
import { IntroAnimation } from "@/components/IntroAnimation";

const Index = () => {
  const [showIntro, setShowIntro] = useState(() => sessionStorage.getItem("intro_shown") !== "1");

  const handleIntroDone = () => {
    sessionStorage.setItem("intro_shown", "1");
    setShowIntro(false);
  };

  return (
    <>
      {showIntro && <IntroAnimation onComplete={handleIntroDone} />}
      <MainApp />
    </>
  );
};

function MainApp() {
  const {
    messages, isProcessing, currentSteps, mode, setMode,
    documents, sendMessage, uploadDocument, removeDocument,
    totalChunks, totalQueries, sessionId, loadSession,
  } = useAgentChat();

  const [historyOpen, setHistoryOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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

      <div className="flex-1 min-w-0">
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
