import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, File, Loader2 } from "lucide-react";
import type { UploadedDocument } from "@/types/agent";

interface DocumentPanelProps {
  documents: UploadedDocument[];
  onUpload: (file: File) => void;
  onRemove: (id: string) => void;
}

export function DocumentPanel({ documents, onUpload, onRemove }: DocumentPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    setIsUploading(true);
    Array.from(files).forEach((file) => {
      setTimeout(() => {
        onUpload(file);
        setIsUploading(false);
      }, 500 + Math.random() * 500);
    });
  }, [onUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />
        Documents
      </h3>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 text-center transition-all ${
          isDragging ? "neon-border-blue bg-primary/5" : "border-border hover:border-primary/30 hover:bg-secondary/50"
        }`}
      >
        {isUploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        ) : (
          <Upload className="h-6 w-6 text-muted-foreground" />
        )}
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-primary">Click to upload</span> or drag & drop
        </div>
        <div className="text-[10px] text-muted-foreground/60">PDF, TXT, DOCX</div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.docx"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Document list */}
      <AnimatePresence>
        {documents.map((doc) => (
          <motion.div
            key={doc.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="group flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2"
          >
            <File className="h-4 w-4 shrink-0 text-neon-blue" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-foreground">{doc.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {formatSize(doc.size)} · {doc.chunks} chunks
              </div>
            </div>
            <button
              onClick={() => onRemove(doc.id)}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
