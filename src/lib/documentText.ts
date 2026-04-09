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

export interface PdfExtractionResult {
  text: string;
  pageImages: string[]; // base64 JPEG images of each page
}

async function extractPdfWithImages(file: File): Promise<PdfExtractionResult> {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;

  try {
    const pages: string[] = [];
    const pageImages: string[] = [];
    const maxPages = Math.min(pdf.numPages, 30); // Cap at 30 pages for vision

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);

      // Extract text
      const textContent = await page.getTextContent();
      const pageText = mergePdfItems(textContent.items);
      if (pageText) pages.push(pageText);

      // Render page to canvas for vision extraction
      try {
        const viewport = page.getViewport({ scale: 1.5 }); // Good quality for OCR
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        // Convert to JPEG base64 (smaller than PNG)
        const imageData = canvas.toDataURL("image/jpeg", 0.85);
        const base64Only = imageData.replace(/^data:image\/jpeg;base64,/, "");
        pageImages.push(base64Only);
        canvas.remove();
      } catch (renderErr) {
        console.warn(`Failed to render page ${pageNumber} to image:`, renderErr);
      }

      page.cleanup();
    }

    return {
      text: normalizeExtractedText(pages.join("\n\n")),
      pageImages,
    };
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
    const result = await extractPdfWithImages(file);
    extractedText = result.text;
  } else {
    extractedText = normalizeExtractedText(await file.text());
  }

  if (!hasReadableText(extractedText)) {
    throw new Error("Readable text could not be extracted from this file. Please upload a text-based PDF/TXT/DOCX file.");
  }

  return extractedText;
}

/**
 * Extract text + page images from PDF for vision-based processing
 */
export async function extractDocumentWithImages(file: File): Promise<{
  text: string;
  pageImages: string[];
  isImageHeavy: boolean;
}> {
  const extension = getFileExtension(file.name);

  if (file.type === "application/pdf" || extension === "pdf") {
    const result = await extractPdfWithImages(file);
    // Determine if PDF is image-heavy (little text extracted relative to pages)
    const avgTextPerPage = result.text.length / Math.max(result.pageImages.length, 1);
    const isImageHeavy = avgTextPerPage < 100 || result.pageImages.length > 0;
    return {
      text: result.text,
      pageImages: result.pageImages,
      isImageHeavy,
    };
  }

  // Non-PDF files
  const text = normalizeExtractedText(await file.text());
  return { text, pageImages: [], isImageHeavy: false };
}
