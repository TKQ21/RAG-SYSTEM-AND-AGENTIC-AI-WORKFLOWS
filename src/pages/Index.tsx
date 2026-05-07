import { useState, useEffect } from "react";
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
        userEmail={"guest@nexus.rag"}
        onLogout={() => {}}
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
