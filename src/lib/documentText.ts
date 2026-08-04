import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";

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

function profileColumns(headerRow: string[], dataRows: string[][]): string[] {
  const lines: string[] = ["## Column profile"];
  for (let c = 0; c < headerRow.length; c += 1) {
    const name = headerRow[c] || `Column ${c + 1}`;
    const counts = new Map<string, number>();
    let nonEmpty = 0;
    let numericCount = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const row of dataRows) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      nonEmpty += 1;
      if (counts.size <= 5000) counts.set(v, (counts.get(v) || 0) + 1);
      const n = Number(v.replace(/,/g, ""));
      if (Number.isFinite(n)) {
        numericCount += 1;
        sum += n;
        if (n < min) min = n;
        if (n > max) max = n;
      }
    }
    const parts = [`- ${name}: non-empty ${nonEmpty}, distinct ${counts.size}`];
    if (numericCount > nonEmpty * 0.7 && numericCount > 0) {
      parts.push(`numeric (min ${min}, max ${max}, avg ${(sum / numericCount).toFixed(2)}, sum ${sum})`);
    }
    lines.push(parts.join(" | "));
    if (counts.size > 0 && counts.size <= 300) {
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
      for (const [value, count] of top) {
        const pct = nonEmpty ? ((count / nonEmpty) * 100).toFixed(2) : "0";
        lines.push(`  Value count -> ${name} = "${value}": ${count} rows (${pct}% of ${nonEmpty})`);
      }
    }
  }
  return lines;
}

function sheetRowsToText(rows: unknown[][], sheetName: string): string {
  if (!rows || rows.length === 0) return "";
  const norm = rows.map((r) =>
    (r || []).map((c) => (c === null || c === undefined ? "" : String(c).replace(/\s+/g, " ").trim()))
  );
  while (norm.length && norm[norm.length - 1].every((c) => !c)) norm.pop();
  if (!norm.length) return "";
  let maxCols = 0;
  for (const r of norm) if (r.length > maxCols) maxCols = r.length;
  for (const r of norm) while (r.length < maxCols) r.push("");

  const header = norm[0];
  const hasHeader = header.some((c) => c && isNaN(Number(c)));
  const headerRow = hasHeader ? header : header.map((_, i) => `Column ${i + 1}`);
  const dataRows = hasHeader ? norm.slice(1) : norm;

  const lines: string[] = [];
  lines.push(`# Sheet: ${sheetName}`);
  lines.push(`Total rows: ${dataRows.length} | Total columns: ${maxCols}`);
  lines.push(`Columns: ${headerRow.map((c, i) => c || `Column ${i + 1}`).join(" | ")}`);
  lines.push("");

  // Analytics-first summary so huge sheets can still answer counting/filtering questions
  // without shipping millions of rows to the backend.
  lines.push(...profileColumns(headerRow, dataRows));
  lines.push("");

  if (dataRows.length <= 150) {
    lines.push(`| ${headerRow.map((c) => c || " ").join(" | ")} |`);
    lines.push(`| ${headerRow.map(() => "---").join(" | ")} |`);
    for (const r of dataRows) {
      lines.push(`| ${r.map((c) => (c || " ").replace(/\|/g, "\\|")).join(" | ")} |`);
    }
    lines.push("");
  }

  // Row-level detail, sampled for very large sheets (head + tail) to stay inside upload limits.
  const HEAD = 2000;
  const TAIL = 400;
  const sampled = dataRows.length > HEAD + TAIL;
  lines.push("## Rows (structured)");
  if (sampled) {
    lines.push(`Large sheet: showing first ${HEAD} and last ${TAIL} of ${dataRows.length} rows. Use the column profile value counts above for totals and filtered counts.`);
  }
  const emit = (r: string[], idx: number) => {
    const parts = r.map((c, i) => `${headerRow[i] || `Column ${i + 1}`}: ${c}`);
    lines.push(`Row ${idx + 1}: ${parts.join(" | ")}`);
  };
  if (sampled) {
    for (let i = 0; i < HEAD; i += 1) emit(dataRows[i], i);
    lines.push(`... ${dataRows.length - HEAD - TAIL} rows omitted ...`);
    for (let i = dataRows.length - TAIL; i < dataRows.length; i += 1) emit(dataRows[i], i);
  } else {
    dataRows.forEach((r, idx) => emit(r, idx));
  }

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

function isPresentation(file: File): boolean {
  const ext = getFileExtension(file.name);
  return ext === "pptx" || ext === "ppt" || file.type.includes("presentationml");
}

function isMarkdown(file: File): boolean {
  const ext = getFileExtension(file.name);
  return ext === "md" || ext === "markdown" || ext === "mdx" || file.type === "text/markdown";
}

function xmlToPlainText(xml: string): string {
  return xml
    .replace(/<a:br\s*\/>/g, "\n")
    .replace(/<\/a:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * PowerPoint (.pptx) extraction: reads slide XML + speaker notes from the OOXML zip.
 * Each slide is labelled as a page so citations can reference slide numbers.
 */
async function extractPresentation(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const n = (s: string) => Number(s.match(/slide(\d+)\.xml$/)?.[1] || 0);
      return n(a) - n(b);
    });

  const parts: string[] = [];
  for (let i = 0; i < slidePaths.length; i += 1) {
    const slideNumber = i + 1;
    const xml = await zip.file(slidePaths[i])!.async("string");
    const body = xmlToPlainText(xml);

    const notesPath = `ppt/notesSlides/notesSlide${slideNumber}.xml`;
    let notes = "";
    const notesFile = zip.file(notesPath);
    if (notesFile) notes = xmlToPlainText(await notesFile.async("string"));

    const block = [`[Page ${slideNumber}]`, `# Slide ${slideNumber}`, body];
    if (notes) block.push(`Speaker notes: ${notes}`);
    if (body || notes) parts.push(block.join("\n"));
  }

  if (!parts.length) {
    throw new Error("No readable text found in this presentation. Legacy .ppt files must be saved as .pptx.");
  }
  return normalizeExtractedText(parts.join("\n\n"));
}

async function extractPlainOrMarkdown(file: File): Promise<string> {
  const raw = await file.text();
  // Markdown is already structured text — keep headings/tables intact for table extraction + citations.
  return normalizeExtractedText(isMarkdown(file) ? raw.replace(/\r\n?/g, "\n") : raw);
}

function isImageFile(file: File): boolean {
  const ext = getFileExtension(file.name);
  return file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"].includes(ext);
}

/** Scanned photos / screenshots are rasterized to JPEG base64 so backend Vision OCR can read them. */
async function imageToJpegBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  canvas.remove();
  bitmap.close?.();
  return dataUrl.replace(/^data:image\/jpeg;base64,/, "");
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
    extractedText = isPresentation(file)
      ? await extractPresentation(file)
      : await extractPlainOrMarkdown(file);
  }

  if (!hasReadableText(extractedText)) {
    throw new Error("Readable text could not be extracted from this file. Supported: PDF, DOCX, TXT, MD, CSV, XLSX, PPTX.");
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

  if (isImageFile(file)) {
    const image = await imageToJpegBase64(file);
    return { text: "", pageImages: [image], isImageHeavy: true, pageCount: 1 };
  }

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

  if (isPresentation(file)) {
    const text = await extractPresentation(file);
    const slideCount = (text.match(/\[Page \d+\]/g) || []).length;
    return { text, pageImages: [], isImageHeavy: false, pageCount: slideCount || 1 };
  }

  const text = await extractPlainOrMarkdown(file);
  return { text, pageImages: [], isImageHeavy: false };
}
