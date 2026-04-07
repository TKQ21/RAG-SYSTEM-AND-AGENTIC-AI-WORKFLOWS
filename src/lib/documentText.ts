import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return Boolean(item && typeof item === "object" && "str" in item);
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasReadableText(text: string): boolean {
  const sample = text.slice(0, 4000);
  const readable = sample.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const replacementChars = sample.match(/�/g)?.length ?? 0;
  return readable >= 20 && replacementChars <= sample.length * 0.1;
}

function mergePdfItems(items: unknown[]): string {
  const lines: string[] = [];
  let currentLine = "";
  let lastY: number | null = null;

  for (const rawItem of items) {
    if (!isPdfTextItem(rawItem)) continue;

    const item = rawItem;
    const text = item.str?.replace(/\s+/g, " ").trim();
    if (!text) continue;

    const y = item.transform?.[5] ?? null;
    const newLine =
      currentLine.length > 0 &&
      ((lastY !== null && y !== null && Math.abs(lastY - y) > 4) || item.hasEOL);

    if (newLine) {
      lines.push(currentLine.trim());
      currentLine = text;
    } else {
      currentLine += currentLine ? ` ${text}` : text;
    }

    lastY = y;
  }

  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines.join("\n");
}

async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;

  try {
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = mergePdfItems(textContent.items);
      if (pageText) pages.push(pageText);
      page.cleanup();
    }

    return normalizeExtractedText(pages.join("\n\n"));
  } finally {
    void pdf.destroy();
  }
}

function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export async function extractDocumentText(file: File): Promise<string> {
  const extension = getFileExtension(file.name);

  let extractedText = "";

  if (file.type === "application/pdf" || extension === "pdf") {
    extractedText = await extractPdfText(file);
  } else {
    extractedText = normalizeExtractedText(await file.text());
  }

  if (!hasReadableText(extractedText)) {
    throw new Error("Readable text could not be extracted from this file. Please upload a text-based PDF/TXT/DOCX file.");
  }

  return extractedText;
}