export interface ParsedCitation {
  document: string;
  page?: number;
  chunk?: number;
}

export interface ParsedAnswer {
  body: string;
  citations: ParsedCitation[];
}

const SOURCE_LINE = /^\s*📌\s*Source:\s*(.+)$/;

/**
 * Splits the trailing "📌 Source: file | Page N | Chunk #n" lines off an answer so
 * they can be rendered as a dedicated Sources panel below the message body.
 */
export function parseAnswerCitations(content: string): ParsedAnswer {
  const lines = content.split("\n");
  const citations: ParsedCitation[] = [];
  const kept: string[] = [];

  for (const line of lines) {
    const match = line.match(SOURCE_LINE);
    if (!match) {
      kept.push(line);
      continue;
    }
    const parts = match[1].split("|").map((p) => p.trim());
    const document = (parts[0] || "").replace(/^\[|\]$/g, "").trim();
    if (!document) continue;
    const pageRaw = parts.find((p) => /^page/i.test(p));
    const chunkRaw = parts.find((p) => /chunk/i.test(p));
    const page = pageRaw ? Number(pageRaw.replace(/[^\d]/g, "")) : undefined;
    const chunk = chunkRaw ? Number(chunkRaw.replace(/[^\d]/g, "")) : undefined;
    const key = `${document}|${page ?? ""}|${chunk ?? ""}`;
    if (citations.some((c) => `${c.document}|${c.page ?? ""}|${c.chunk ?? ""}` === key)) continue;
    citations.push({
      document,
      page: Number.isFinite(page as number) ? (page as number) : undefined,
      chunk: Number.isFinite(chunk as number) ? (chunk as number) : undefined,
    });
  }

  return { body: kept.join("\n").replace(/\n{3,}$/, "\n").trimEnd(), citations };
}
