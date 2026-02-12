import { AppSidebar } from "@/components/AppSidebar";
import { ChatArea } from "@/components/ChatArea";
import { useAgentChat } from "@/hooks/useAgentChat";

const Index = () => {
  const {
    messages,
    isProcessing,
    currentSteps,
    mode,
    setMode,
    documents,
    sendMessage,
    uploadDocument,
    removeDocument,
  } = useAgentChat();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <AppSidebar
        mode={mode}
        onModeChange={setMode}
        documents={documents}
        onUpload={uploadDocument}
        onRemoveDoc={removeDocument}
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
};

export default Index;
