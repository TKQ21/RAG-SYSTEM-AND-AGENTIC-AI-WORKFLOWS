import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

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
  pdfBase64?: string;
  pageCount: number;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function extractPdfWithImages(file: File): Promise<PdfExtractionResult> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const pdfBase64 = file.size <= 20 * 1024 * 1024 ? uint8ToBase64(data) : undefined;
  const loadingTask = getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;

  try {
    const pages: string[] = [];
    const pageImages: string[] = [];
    const maxPages = pdf.numPages;
    const maxFallbackImages = 16;

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);

      // Extract text
      const textContent = await page.getTextContent();
      const pageText = mergePdfItems(textContent.items);
      if (pageText) pages.push(`[Page ${pageNumber}]\n${pageText}`);

      // Only render fallback page images for text-poor pages. The backend receives the raw PDF
      // for full Gemini Vision OCR, so text PDFs no longer waste upload time rasterizing every page.
      const readableChars = pageText.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
      if (readableChars < 80 && pageImages.length < maxFallbackImages) {
        try {
          const viewport = page.getViewport({ scale: 1.35 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
          const imageData = canvas.toDataURL("image/jpeg", 0.78);
          const base64Only = imageData.replace(/^data:image\/jpeg;base64,/, "");
          pageImages.push(base64Only);
          canvas.remove();
        } catch (renderErr) {
          console.warn(`Failed to render page ${pageNumber} to image:`, renderErr);
        }
      }

      page.cleanup();
    }

    return {
      text: normalizeExtractedText(pages.join("\n\n")),
      pageImages,
      pdfBase64,
      pageCount: pdf.numPages,
    };
  } finally {
    void pdf.destroy();
  }
}

function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function cellToText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object" && cell && "v" in cell) {
    try {
      return XLSX.utils.format_cell(cell as XLSX.CellObject).replace(/\s+/g, " ").trim();
    } catch {
      return String((cell as { v?: unknown }).v ?? "").replace(/\s+/g, " ").trim();
    }
  }
  return String(cell).replace(/\s+/g, " ").trim();
}

function worksheetToRows(ws: XLSX.WorkSheet): unknown[][] {
  const sheet = ws as unknown as Record<string, unknown> & unknown[][];
  const rowsByIndex = new Map<number, string[]>();

  if (Array.isArray(sheet)) {
    for (let r = 0; r < sheet.length; r += 1) {
      const srcRow = sheet[r];
      if (!Array.isArray(srcRow)) continue;
      const row: string[] = [];
      for (let c = 0; c < srcRow.length; c += 1) {
        const value = cellToText(srcRow[c]);
        if (value) row[c] = value;
      }
      while (row.length && !row[row.length - 1]) row.pop();
      if (row.some(Boolean)) rowsByIndex.set(r, row);
    }
  } else {
    for (const address of Object.keys(sheet)) {
      if (address[0] === "!") continue;
      const decoded = XLSX.utils.decode_cell(address);
      const value = cellToText(sheet[address]);
      if (!value) continue;
      const row = rowsByIndex.get(decoded.r) || [];
      row[decoded.c] = value;
      rowsByIndex.set(decoded.r, row);
    }
  }

  return Array.from(rowsByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => {
      while (row.length && !row[row.length - 1]) row.pop();
      return row;
    });
}

function sheetRowsToText(rows: unknown[][], sheetName: string): string {
  if (!rows || rows.length === 0) return "";
  // Normalize each cell to string
  const norm = rows.map((r) =>
    (r || []).map((c) => (c === null || c === undefined ? "" : String(c).replace(/\s+/g, " ").trim()))
  );
  // Trim trailing empty rows
  while (norm.length && norm[norm.length - 1].every((c) => !c)) norm.pop();
  if (!norm.length) return "";
  let maxCols = 0;
  for (const r of norm) if (r.length > maxCols) maxCols = r.length;
  for (const r of norm) while (r.length < maxCols) r.push("");

  const header = norm[0];
  const body = norm.slice(1);
  const hasHeader = header.some((c) => c && isNaN(Number(c)));

  const lines: string[] = [];
  lines.push(`# Sheet: ${sheetName}`);
  lines.push(`Total rows: ${body.length} | Total columns: ${maxCols}`);
  lines.push("");

  // Markdown table for smaller sheets. Large sheets stay row-structured so uploads do not crash or truncate.
  const headerRow = hasHeader ? header : header.map((_, i) => `Column ${i + 1}`);
  const dataRows = hasHeader ? body : norm;
  if (dataRows.length <= 200) {
    lines.push(`| ${headerRow.map((c) => c || " ").join(" | ")} |`);
    lines.push(`| ${headerRow.map(() => "---").join(" | ")} |`);
    for (const r of dataRows) {
      lines.push(`| ${r.map((c) => (c || " ").replace(/\|/g, "\\|")).join(" | ")} |`);
    }
    lines.push("");
  } else {
    lines.push(`Columns: ${headerRow.map((c, i) => c || `Column ${i + 1}`).join(" | ")}`);
    lines.push("Large sheet: rows are stored below in structured format for exact counting/filtering.");
    lines.push("");
  }

  // Also add plain row-by-row block so chunker can index per row
  lines.push("## Rows (structured)");
  dataRows.forEach((r, idx) => {
    const parts = r.map((c, i) => `${headerRow[i] || `Column ${i + 1}`}: ${c}`);
    lines.push(`Row ${idx + 1}: ${parts.join(" | ")}`);
  });

  return lines.join("\n");
}

async function extractSpreadsheet(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", dense: true, cellDates: true, raw: false });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = worksheetToRows(ws);
    const text = sheetRowsToText(rows as unknown[][], name);
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

function isSpreadsheet(file: File): boolean {
  const ext = getFileExtension(file.name);
  return (
    ext === "xlsx" || ext === "xls" || ext === "csv" ||
    file.type.includes("spreadsheet") || file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel"
  );
}

export async function extractDocumentText(file: File): Promise<string> {
  const extension = getFileExtension(file.name);

  let extractedText = "";

  if (file.type === "application/pdf" || extension === "pdf") {
    const result = await extractPdfWithImages(file);
    extractedText = result.text;
  } else if (extension === "docx" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    extractedText = normalizeExtractedText(result.value || "");
  } else if (isSpreadsheet(file)) {
    extractedText = await extractSpreadsheet(file);
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
  pdfBase64?: string;
  pageCount?: number;
}> {
  const extension = getFileExtension(file.name);

  if (file.type === "application/pdf" || extension === "pdf") {
    const result = await extractPdfWithImages(file);
    // Determine if PDF is image-heavy (little text extracted relative to pages)
    const avgTextPerPage = result.text.length / Math.max(result.pageCount, 1);
    const isImageHeavy = result.text.length < 500 || avgTextPerPage < 120;
    return {
      text: result.text,
      pageImages: result.pageImages,
      isImageHeavy,
      pdfBase64: result.pdfBase64,
      pageCount: result.pageCount,
    };
  }

  if (isSpreadsheet(file)) {
    const text = await extractSpreadsheet(file);
    return { text, pageImages: [], isImageHeavy: false };
  }

  // Non-PDF files
  if (extension === "docx" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    const text = normalizeExtractedText(result.value || "");
    return { text, pageImages: [], isImageHeavy: false };
  }

  const text = normalizeExtractedText(await file.text());
  return { text, pageImages: [], isImageHeavy: false };
}
