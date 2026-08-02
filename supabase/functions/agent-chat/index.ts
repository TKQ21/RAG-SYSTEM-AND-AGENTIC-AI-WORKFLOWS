import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Message = { role: "system" | "user" | "assistant"; content: string };
type RetrievedChunk = {
  id: string;
  document_id: string;
  document_name: string;
  content: string;
  chunk_index: number;
  page_num?: number;
  similarity: number;
  keywordScore?: number;
  hybridScore?: number;
};

const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const CHAT_MODEL = "google/gemini-2.5-flash";
const DEFAULT_MAX_TOKENS = 8192;
const LONG_FORM_MAX_TOKENS = 32768;
const LONG_FORM_CONTINUATION_ROUNDS = 3;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gatewayFetch(path: string, body: unknown, attempts = 2): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const res = await fetch(`${GATEWAY}${path}`, {
      method: "POST",
      headers: { "Lovable-API-Key": LOVABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) return res;
    last = res;
    await wait(700 * (attempt + 1));
  }
  return last!;
}

async function embed(text: string, _taskType = "RETRIEVAL_QUERY"): Promise<number[] | null> {
  try {
    const res = await gatewayFetch("/embeddings", {
      model: "openai/text-embedding-3-small",
      input: text.slice(0, 8000),
      dimensions: 768,
    });
    if (!res.ok) {
      console.error("embed failed", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const json = await res.json();
    return json.data?.[0]?.embedding || null;
  } catch (e) {
    console.error("embed err", e);
    return null;
  }
}

async function embedMany(texts: string[]): Promise<(number[] | null)[]> {
  if (!texts.length) return [];
  try {
    const res = await gatewayFetch("/embeddings", {
      model: "openai/text-embedding-3-small",
      input: texts.map((t) => t.slice(0, 8000)),
      dimensions: 768,
    });
    if (!res.ok) {
      console.error("embed many failed", res.status, (await res.text()).slice(0, 200));
      return Promise.all(texts.map((t) => embed(t)));
    }
    const json = await res.json();
    const byIndex = new Map<number, number[]>();
    for (const item of json.data || []) byIndex.set(item.index ?? 0, item.embedding || null);
    return texts.map((_, i) => byIndex.get(i) || null);
  } catch (e) {
    console.error("embed many err", e);
    return Promise.all(texts.map((t) => embed(t)));
  }
}

function normalizeQuery(q: string): string {
  return String(q || "")
    .toLowerCase()
    .replace(/\b(ka|ki|ke|mai|mein|me|kya|hai|toh|aur|se|ko|kitni|kitna|batao|please|yr|yaar|likha|bata|do|kar|kare|wala|wale|wali|section|dashboard)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywords(text: string): string[] {
  // preserve numeric ranges like 40-50, 41-50, 71+
  return normalizeQuery(text)
    .replace(/[^\p{L}\p{N}\-+\s]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-+]+|[-+]+$/g, (m) => (/\d/.test(w) ? m : "")))
    .filter((w) => (/\d/.test(w) || w.length >= 2) && !/^(the|and|for|with|from|this|that|what|which|how|who|pdf|document|about)$/.test(w));
}

function expandedKeywords(question: string): string[] {
  const base = keywords(question);
  const q = normalizeQuery(question);
  const extras: string[] = [];

  // Hinglish/semantic bridge: users often call marksheets / statements "admit card" or ask "kis person ka hai".
  // The extracted document usually contains fields like Name, Exam Roll No, Enrollment No instead.
  if (/(admit\s*card|marksheet|mark\s*sheet|result|grade\s*card|person|candidate|student|naam|name|kiska|kis)/i.test(q)) {
    extras.push("name", "father", "mother", "enrollment", "roll", "course", "semester", "college");
  }
  if (/(subject|paper|exam|date|time|timing|details?)/i.test(q)) {
    extras.push("paper", "subject", "exam", "date", "time", "code", "commerce", "management", "business");
  }

  return Array.from(new Set([...base, ...extras].filter((w) => w.length >= 2)));
}

function keywordScore(question: string, content: string): number {
  const qWords = expandedKeywords(question);
  if (qWords.length === 0) return 0;
  const haystack = ` ${content.toLowerCase()} `;
  let score = 0;
  let numericHits = 0;
  let numericTotal = 0;
  for (const word of qWords) {
    const isNumeric = /\d/.test(word);
    if (isNumeric) numericTotal += 1;
    if (haystack.includes(word)) {
      score += isNumeric ? 2 : 1; // numeric tokens (40-50, 71+, roll numbers) weigh more
      if (isNumeric) numericHits += 1;
    }
  }
  const base = score / (qWords.length + numericTotal); // normalise with numeric boost
  // strong bonus when ALL numeric tokens are present in the chunk
  const numericBonus = numericTotal > 0 && numericHits === numericTotal ? 0.4 : 0;
  return Math.min(1, base + numericBonus);
}

function buildVariants(question: string): string[] {
  const norm = normalizeQuery(question);
  const expanded = expandedKeywords(question).join(" ");
  return Array.from(new Set([question, norm, keywords(question).join(" "), expanded].filter((s) => s && s.length > 1)));
}

// Restrict a document_chunks query to one knowledge space when the user has a space selected.
function scopeSpace(query: any, spaceId: string | null) {
  return spaceId ? query.eq("space_id", spaceId) : query;
}

async function keywordFallbackSearch(supabase: any, question: string, userId: string, spaceId: string | null = null): Promise<RetrievedChunk[]> {
  const terms = expandedKeywords(question)
    .filter((term) => (/\d/.test(term) || term.length >= 3) && !/^(isme|kis|kya|hai)$/.test(term))
    .slice(0, 14);
  if (!terms.length) return [];

  const orFilter = terms
    .map((term) => `content.ilike.%${term.replace(/[%,()]/g, " ").trim()}%`)
    .filter(Boolean)
    .join(",");
  if (!orFilter) return [];

  const { data, error } = await scopeSpace(
    supabase
      .from("document_chunks")
      .select("id,document_id,document_name,content,chunk_index,page_num")
      .eq("user_id", userId),
    spaceId,
  )
    .or(orFilter)
    .limit(60);
  if (error) {
    console.error("keyword fallback failed:", error.message);
    return [];
  }
  return ((data || []) as any[])
    .map((row) => {
      const kScore = keywordScore(question, row.content);
      return { ...row, similarity: Math.max(0.65, kScore), keywordScore: kScore, hybridScore: kScore };
    })
    .filter((row) => (row.keywordScore || 0) > 0)
    .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0));
}

function strictPrompt(): string {
  return `You are a strict NotebookLM-style document intelligence assistant.

CRITICAL RULES:
1. Answer ONLY from [Context]. Never use outside knowledge.
2. Understand the user's semantic intent in English/Hindi/Hinglish, then map it to the relevant context chunks.
3. Answer ONLY what the user asked. Do NOT dump student identity, all papers, summaries, or unrelated chunks unless the user asks for all/details/summary.
4. If relevant context chunks are provided, DO NOT reject the question just because the user's wording is imperfect. Answer with the closest exact fields/lines available in the context and clearly say which requested field is not present. Only say "I could not find a relevant answer in the provided documents." when the context has no related information at all.
5. Preserve exact spelling, numbers, symbols, casing, alphabet/letter, and word order from the source. Do not autocorrect OCR text unless asked.
6. TABLES / PAPER DETAILS / MARKSHEETS: if the answer comes from a table, return a clean markdown table with only the relevant row(s) and columns. If the user asks about one paper/subject (e.g. "Hindi B paper kis din hai"), return ONLY that paper row and the exact requested field (day/date/time), not the whole admit card.
7. If multiple values for the requested field exist, list ALL matching values with exact labels.
8. POWER BI / CHART TABLES: exported text from Power BI charts is UNRELIABLE for index alignment because bars are usually drawn sorted by VALUE DESCENDING while the legend keeps a different order. NEVER assume label[i] pairs with value[i]. Instead:
   (a) Find the chart title (e.g. "Survival rate by Age Group").
   (b) Read both the category list and the numeric value list under that title.
   (c) Sort the values in DESCENDING order. The largest value belongs to the FIRST visible bar. The chart's category list is usually already in that descending order — pair them in the order they appear (label[0]↔valueDesc[0], label[1]↔valueDesc[1], ...).
   (d) Show the full mapping you derived ("Categories: [...]  Values (sorted desc): [...]") before stating the final answer for the requested category.
   Example: chart "Survival rate by Age Group" labels "61-70 40-50 51-60 BELOW 40 71+" with values "75.90% 40.38% 71.59% 74.32% 50.00%". After sorting values descending: 75.90, 74.32, 71.59, 50.00, 40.38 → 61-70=75.90%, 40-50=74.32%, 51-60=71.59%, BELOW 40=50.00%, 71+=40.38%.
9. For "about / biography / introduction / overview / who is / kaun hai / bare mai / baare mai" questions, return EVERY biographical sentence in the context (birth, family, education, career, awards, philanthropy). Do NOT truncate, do NOT summarise — copy verbatim and stitch consecutive chunks. Aim for a complete multi-paragraph answer (200+ words) when the source has it.
10. Keep answers concise (2-4 sentences) ONLY for narrow single-fact questions. For "about / list / all / full / summary / detail / deep analysis" questions give the complete answer, structured with headings and tables where useful.
11. Match student NAME, Roll No, and Enrollment No interchangeably (e.g., "MOHD KAIF" and "25345201387" refer to the same student). Report all subjects, grades, SGPA, and result status found only when asked.
12. If the user says "admit card", "hall ticket", "person", "candidate", "student", "naam/name", and the context has an admit card / hall ticket / marksheet / result / statement of marks, answer from the Name / Father's Name / Roll No / Enrollment / Course / Exam Centre / Paper Details fields instead of rejecting it.
13. If the user asks for subjects + grades but the context is an admit card/hall ticket with Paper Details and no grades, list the paper/subject details exactly and state: "Grades/result status is not present in this document."
14. POSITION QUERIES ("Nth word", "Nth letter", "Nth alphabet", "kth character", "word #N of question X", "case scenario X qN mai N-th word"):
    (a) Locate the exact target sentence/question from the context verbatim (e.g., Question 9 in Case Scenario IV).
    (b) Tokenize by splitting ONLY on whitespace. Compound tokens joined by "/" or "-" (e.g. "his/her", "40-50", "father-in-law") count as ONE word. Punctuation stays attached to the word it touches unless the user asks for "letter/character".
    (c) When the target is "Q.N / Question N / point N / instruction N / step N", DROP the leading label token (Q.4, 4., (4), Question 4) before counting — the user's Nth word is the Nth word of the actual sentence, not of the label.
    (d) Count strictly from 1 (1-based). Do NOT skip articles, numbers, or symbols inside the sentence.
    (e) Reply in this exact format: 'The Nth word of <target> is "<word>". Full sentence: "<sentence>". Tokens: 1) <w1> 2) <w2> ...'  so the user can verify the count.
    (f) If the target sentence isn't clearly present, say "The exact sentence for <target> is not in the retrieved context." — do NOT guess.
15. CITATIONS (mandatory, two levels):
    (a) Inline: right after each fact/sentence taken from the context, add a compact marker [filename, p.N] using the File and Page values shown in the context header. Group repeated markers instead of repeating the same one twice in a row.
    (b) At the end, list up to 3 sources, one per line, in this exact format:
📌 Source: [filename] | Page [N] | Chunk #[n]
Temperature is 0: deterministic, no guessing.`;
}

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (c) =>
        `[Chunk #${c.chunk_index} | File: ${c.document_name} | Page: ${c.page_num ?? 1} | Sim: ${Math.round((c.similarity || 0) * 100)}% | KW: ${Math.round((c.keywordScore || 0) * 100)}%]\n${c.content}`,
    )
    .join("\n\n---\n\n")
    .slice(0, 70000);
}

function isDeepIntent(question: string): boolean {
  return /\b(about|biography|biograph|overview|introduction|intro|who is|kaun|bare|baare|complete|full|all|list|history|career|life|analysis|analyze|analyse|deep|detail|details|explain|summary|summarise|long|poora|pura|saara|sara|sab)\b/i.test(question);
}

async function expandDocumentContext(
  supabase: any,
  userId: string,
  chunks: RetrievedChunk[],
  question: string,
  spaceId: string | null = null,
): Promise<RetrievedChunk[]> {
  if (!chunks.length) return chunks;
  const wide = isDeepIntent(question);
  const radius = wide ? 10 : 2;
  const topN = wide ? 4 : 6;
  const seen = new Map<string, RetrievedChunk>();
  chunks.forEach((c) => seen.set(c.id, c));

  if (wide) {
    const docIds = Array.from(new Set(chunks.slice(0, 6).map((c) => c.document_id))).slice(0, 2);
    const { data, error } = await scopeSpace(
      supabase
        .from("document_chunks")
        .select("id,document_id,document_name,content,chunk_index,page_num")
        .eq("user_id", userId),
      spaceId,
    )
      .in("document_id", docIds)
      .order("chunk_index", { ascending: true })
      .limit(350);
    if (!error) {
      for (const row of (data || []) as any[]) {
        if (!seen.has(row.id)) seen.set(row.id, { ...row, similarity: 0, keywordScore: 0, hybridScore: 0 });
      }
    } else {
      console.error("wide context fetch failed:", error.message);
    }
  } else {
    const neighborKeys = new Set<string>();
    for (const c of chunks.slice(0, topN)) {
      for (let off = -radius; off <= radius; off++) {
        if (off === 0) continue;
        neighborKeys.add(`${c.document_id}:${c.chunk_index + off}`);
      }
    }
    const haveKeys = new Set(chunks.map((c) => `${c.document_id}:${c.chunk_index}`));
    const missing = Array.from(neighborKeys).filter((k) => !haveKeys.has(k));
    if (missing.length > 0) {
      const orFilter = missing
        .map((k) => {
          const [doc, idx] = k.split(":");
          return `and(document_id.eq.${doc},chunk_index.eq.${idx})`;
        })
        .join(",");
      const { data, error } = await scopeSpace(
        supabase
          .from("document_chunks")
          .select("id,document_id,document_name,content,chunk_index,page_num")
          .eq("user_id", userId),
        spaceId,
      ).or(orFilter);
      if (!error) {
        for (const n of (data || []) as any[]) {
          if (!seen.has(n.id)) seen.set(n.id, { ...n, similarity: 0, keywordScore: 0, hybridScore: 0 });
        }
      } else {
        console.error("neighbor fetch failed:", error.message);
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    if (a.document_id === b.document_id) return a.chunk_index - b.chunk_index;
    return (b.hybridScore || b.similarity || 0) - (a.hybridScore || a.similarity || 0);
  });
}

function escapeSse(text: string): Uint8Array {
  const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return new TextEncoder().encode(payload);
}

function sseTextResponse(text: string): Response {
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(escapeSse(text)); controller.close(); } }), {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}

function uniqueLines(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function fieldValue(context: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = context.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:\\-]\\s*([^\\n]+)`, "i"));
  return match?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function normalizeLoose(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}+\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type PaperRow = {
  raw: string;
  subject: string;
  examCode: string;
  part: string;
  group: string;
  day: string;
  date: string;
  time: string;
  remarks: string;
};

function extractPaperRows(context: string): PaperRow[] {
  const paperMatch = context.match(/Paper\s+Details[\s\S]{0,5000}?(?=Instructions\s*\/|General Instructions|Principal|Controller of Examinations|$)/i);
  const section = paperMatch?.[0] || context;
  const lines = uniqueLines(section)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !/^Paper Details\b/i.test(line) && !/^ExamCode\b/i.test(line) && !/^Exam\s*Code\b/i.test(line));

  const combinedRows: string[] = [];
  let pendingSubject = "";
  for (const line of lines) {
    const hasCode = /\b\d{6,12}\b/.test(line);
    if (!hasCode) {
      if (/^(instructions|note|principal|controller)/i.test(line)) break;
      if (/[A-Za-z]/.test(line)) pendingSubject = pendingSubject ? `${pendingSubject} ${line}` : line;
      continue;
    }
    combinedRows.push(`${pendingSubject ? `${pendingSubject} ` : ""}${line}`.trim());
    pendingSubject = "";
  }

  return combinedRows.map((raw) => {
    const examCode = raw.match(/\b\d{6,12}\b/)?.[0] || "";
    const beforeCode = examCode ? raw.slice(0, raw.indexOf(examCode)).trim() : raw;
    const afterCode = examCode ? raw.slice(raw.indexOf(examCode) + examCode.length).trim() : "";
    const day = afterCode.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i)?.[0] || "";
    const date = afterCode.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/)?.[0] || "";
    const time = afterCode.match(/\b\d{1,2}:\d{2}\b/)?.[0] || "";
    const pieces = afterCode.split(/\s+/).filter(Boolean);
    const part = pieces.find((piece) => /^\d+$/.test(piece)) || "";
    const group = pieces.find((piece) => piece === "-" || /^[A-Z]$/i.test(piece)) || "";
    const remarks = afterCode.endsWith("-") ? "-" : "";
    return { raw, subject: beforeCode, examCode, part, group, day, date, time, remarks };
  }).filter((row) => row.examCode && row.subject);
}

function subjectTokensFromQuestion(question: string): string[] {
  const filler = /\b(paper|subject|details?|detail|exam|code|kis|kiska|ka|ki|ke|kon|kaun|din|day|date|tarikh|time|timing|kab|hai|me|mein|mai|batao|bata|do|please|kya|which|what|when|is|the|of|in|for)\b/gi;
  return normalizeLoose(question.replace(filler, " "))
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function scorePaperRow(questionTokens: string[], row: PaperRow): number {
  const subject = normalizeLoose(row.subject);
  if (!questionTokens.length) return 0;
  let score = 0;
  for (const token of questionTokens) {
    if (subject.split(/\s+/).includes(token)) score += 3;
    else if (subject.includes(token)) score += 2;
    else if (normalizeLoose(row.raw).includes(token)) score += 1;
  }
  return score;
}

function paperDetailAnswer(question: string, chunks: RetrievedChunk[]): string | null {
  const wantsPaper = /\b(subjects?|papers?|exam\s*code|examcode|paper\s*details|din|day|date|tarikh|time|timing|kab)\b/i.test(question);
  if (!wantsPaper || !chunks.length) return null;

  const ordered = [...chunks].sort((a, b) => {
    if (a.document_id === b.document_id) return a.chunk_index - b.chunk_index;
    return (b.hybridScore || b.similarity || 0) - (a.hybridScore || a.similarity || 0);
  });
  const context = ordered.map((c) => c.content).join("\n");
  const rows = extractPaperRows(context);
  if (!rows.length) return null;

  const qTokens = subjectTokensFromQuestion(question);
  const scored = rows
    .map((row) => ({ row, score: scorePaperRow(qTokens, row) }))
    .sort((a, b) => b.score - a.score);
  const bestScore = scored[0]?.score || 0;
  const asksAll = /\b(all|saare|sare|sab|list|full|complete|details?)\b/i.test(question) && bestScore === 0;
  const matches = asksAll ? rows : scored.filter((item) => item.score === bestScore && item.score > 0).map((item) => item.row);
  if (!matches.length) return null;

  const wantsDay = /\b(din|day|kab|when)\b/i.test(question);
  const wantsDate = /\b(date|tarikh)\b/i.test(question);
  const wantsTime = /\b(time|timing|samay)\b/i.test(question);
  const wantsCode = /\b(code|exam\s*code|examcode)\b/i.test(question);
  const narrow = matches.length === 1 && (wantsDay || wantsDate || wantsTime || wantsCode);
  const source = ordered.find((c) => matches.some((row) => c.content.includes(row.examCode) || c.content.includes(row.subject.split(/\s+/)[0]))) || ordered[0];

  if (narrow) {
    const r = matches[0];
    const fields: string[] = [];
    if (wantsDay) fields.push(`Day: **${r.day || "Not present"}**`);
    if (wantsDate) fields.push(`Date: **${r.date || "Not present"}**`);
    if (wantsTime) fields.push(`Time: **${r.time || "Not present"}**`);
    if (wantsCode) fields.push(`Exam Code: **${r.examCode || "Not present"}**`);
    return `**${r.subject}**\n\n${fields.join("\n")}\n\n| Subject/Paper | Exam Code | Part | Group | Day | Date | Time | Remarks |\n|---|---:|---:|---|---|---|---|---|\n| ${r.subject} | ${r.examCode} | ${r.part || "-"} | ${r.group || "-"} | ${r.day || "-"} | ${r.date || "-"} | ${r.time || "-"} | ${r.remarks || "-"} |\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
  }

  const table = matches
    .slice(0, 12)
    .map((r) => `| ${r.subject} | ${r.examCode} | ${r.part || "-"} | ${r.group || "-"} | ${r.day || "-"} | ${r.date || "-"} | ${r.time || "-"} | ${r.remarks || "-"} |`)
    .join("\n");
  return `| Subject/Paper | Exam Code | Part | Group | Day | Date | Time | Remarks |\n|---|---:|---:|---|---|---|---|---|\n${table}\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
}

function exactStructuredAnswer(question: string, chunks: RetrievedChunk[]): string | null {
  if (!chunks.length) return null;
  const paperAnswer = paperDetailAnswer(question, chunks);
  if (paperAnswer) return paperAnswer;

  const q = question.toLowerCase();
  const ordered = [...chunks].sort((a, b) => {
    if (a.document_id === b.document_id) return a.chunk_index - b.chunk_index;
    return (b.hybridScore || b.similarity || 0) - (a.hybridScore || a.similarity || 0);
  });
  const context = ordered.map((c) => c.content).join("\n");
  const source = ordered[0];

  const wantsIdentity = /\b(admit\s*card|hall\s*ticket|person|candidate|student|naam|name|kiska|kis\s+person|roll|enrollment|father|course|centre|center)\b/i.test(q);
  const wantsPapers = /\b(subjects?|papers?|exam\s*code|examcode|grades?|result|marks?|paper\s*details)\b/i.test(q);

  if (!wantsIdentity && !wantsPapers) return null;

  const fields: string[] = [];
  const fieldLabels = ["Name", "Sol Roll No.", "SOL Roll No.", "Exam Roll No.", "Enrollment No.", "Father's Name", "Course Name", "Exam Centre"];
  const used = new Set<string>();
  for (const label of fieldLabels) {
    const value = fieldValue(context, label);
    const cleanLabel = label.replace("SOL", "Sol");
    if (value && !used.has(cleanLabel.toLowerCase())) {
      used.add(cleanLabel.toLowerCase());
      fields.push(`- ${cleanLabel}: ${value}`);
    }
  }

  let paperLines: string[] = [];
  const paperMatch = context.match(/Paper\s+Details[\s\S]{0,2600}?(?=Instructions\s*\/|Principal|Controller of Examinations|$)/i);
  if (paperMatch) {
    paperLines = uniqueLines(paperMatch[0])
      .filter((line) => !/^Paper Details\s*$/i.test(line))
      .slice(0, 28);
  } else if (wantsPapers) {
    paperLines = uniqueLines(context)
      .filter((line) => /(commerce|hindi|english|computer science|bba|accounting|law|management|investment|flutter|examcode|\b\d{10}\b)/i.test(line))
      .slice(0, 28);
  }

  if (!fields.length && !paperLines.length) return null;

  const parts: string[] = [];
  if (fields.length && (wantsIdentity || !paperLines.length)) parts.push(`Exact student/person details found:\n${fields.join("\n")}`);
  if (paperLines.length) parts.push(`Exact paper/subject details found:\n${paperLines.map((line) => `- ${line}`).join("\n")}`);
  if (/\b(grades?|result|marks?)\b/i.test(q) && !/\b(grade|sgpa|cgpa|result|marks?)\b/i.test(paperLines.join(" "))) {
    parts.push("Grades/result status is not present in this document.");
  }

  return `${parts.join("\n\n")}\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
}

type SheetRow = {
  document_id: string;
  document_name: string;
  chunk_index: number;
  rowNumber: number;
  raw: string;
  fields: Record<string, string>;
};

function normalKey(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalValue(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[₹$,%]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sameCellValue(cell: string, expected: string): boolean {
  const a = normalValue(cell);
  const b = normalValue(expected);
  if (!a || !b) return false;
  const na = Number(a.replace(/,/g, ""));
  const nb = Number(b.replace(/,/g, ""));
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return a === b || a.includes(b);
}

function parseSheetRows(chunks: RetrievedChunk[]): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const chunk of chunks) {
    for (const line of chunk.content.split(/\n+/)) {
      const match = line.match(/^Row\s+(\d+)\s*:\s*(.+)$/i);
      if (!match) continue;
      const fields: Record<string, string> = {};
      for (const part of match[2].split(/\s+\|\s+/)) {
        const idx = part.indexOf(":");
        if (idx <= 0) continue;
        const key = part.slice(0, idx).replace(/\s+/g, " ").trim();
        const value = part.slice(idx + 1).replace(/\s+/g, " ").trim();
        if (key) fields[key] = value;
      }
      rows.push({
        document_id: chunk.document_id,
        document_name: chunk.document_name,
        chunk_index: chunk.chunk_index,
        rowNumber: Number(match[1]),
        raw: line.trim(),
        fields,
      });
    }
  }
  return rows;
}

function extractSheetMeta(chunks: RetrievedChunk[]): { rows?: number; cols?: number; columns?: string[] } {
  const text = chunks.map((c) => c.content).join("\n");
  const total = text.match(/Total rows:\s*(\d+)\s*\|\s*Total columns:\s*(\d+)/i);
  const colsLine = text.match(/^Columns:\s*(.+)$/im);
  return {
    rows: total ? Number(total[1]) : undefined,
    cols: total ? Number(total[2]) : undefined,
    columns: colsLine ? colsLine[1].split(/\s+\|\s+/).map((c) => c.trim()).filter(Boolean) : undefined,
  };
}

function pickSheetColumn(question: string, rows: SheetRow[], metaColumns: string[] = []): string | null {
  const allColumns = Array.from(new Set([...metaColumns, ...rows.flatMap((r) => Object.keys(r.fields))].filter(Boolean)));
  const q = normalKey(question);
  const ranked = allColumns
    .map((column) => ({ column, key: normalKey(column) }))
    .filter((item) => item.key)
    .sort((a, b) => b.key.length - a.key.length);
  return ranked.find((item) => q.includes(item.key))?.column || null;
}

function valueAfterColumn(question: string, column: string): string | null {
  const qTokens = normalKey(question).split(/\s+/).filter(Boolean);
  const colTokens = normalKey(column).split(/\s+/).filter(Boolean);
  const stop = new Set([
    "ka", "ki", "ke", "hai", "hain", "me", "mein", "mai", "isme", "rows", "row", "kitni", "kitne", "kitna", "how", "many", "count", "total", "value", "equals", "equal", "is", "are", "of", "the", "bata", "batao", "do",
  ]);
  for (let i = 0; i <= qTokens.length - colTokens.length; i += 1) {
    const hit = colTokens.every((token, j) => qTokens[i + j] === token);
    if (!hit) continue;
    for (let j = i + colTokens.length; j < qTokens.length; j += 1) {
      const token = qTokens[j];
      if (!token || stop.has(token)) continue;
      return token;
    }
    for (let j = i - 1; j >= 0; j -= 1) {
      const token = qTokens[j];
      if (!token || stop.has(token)) continue;
      return token;
    }
  }
  return null;
}

function markdownCell(text: string): string {
  return String(text || "-").replace(/\|/g, "\\|");
}

function spreadsheetAnswerFromRows(question: string, chunks: RetrievedChunk[]): string | null {
  const q = question.toLowerCase();
  const asksSheet = /\b(rows?|columns?|cols?|kitni|kitne|count|total|how many|csv|excel|xlsx|xls|sheet)\b/i.test(q);
  if (!asksSheet) return null;

  const rows = parseSheetRows(chunks);
  const meta = extractSheetMeta(chunks);
  if (!rows.length && !meta.rows && !meta.cols) return null;
  const source = chunks[0];

  if (/\b(columns?|cols?)\b|columns?\s+hai|kitne\s+columns/i.test(q)) {
    const columns = meta.columns || Array.from(new Set(rows.flatMap((r) => Object.keys(r.fields))));
    return `Total columns: **${meta.cols || columns.length}**\n\n| # | Column |\n|---:|---|\n${columns.map((c, i) => `| ${i + 1} | ${markdownCell(c)} |`).join("\n")}\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
  }

  const column = pickSheetColumn(question, rows, meta.columns);
  if (!column) {
    if (/\b(rows?|kitni|kitne|count|total|how many)\b/i.test(q)) {
      return `Total rows: **${meta.rows || rows.length}**\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
    }
    return null;
  }

  const expected = valueAfterColumn(question, column);
  if (!expected) {
    const nonEmpty = rows.filter((row) => String(row.fields[column] || "").trim()).length;
    const unique = new Set(rows.map((row) => normalValue(row.fields[column] || "")).filter(Boolean));
    return `Column **${column}** has **${nonEmpty}** non-empty rows and **${unique.size}** unique values.\n\n| Metric | Count |\n|---|---:|\n| Non-empty rows | ${nonEmpty} |\n| Unique values | ${unique.size} |\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
  }

  const matches = rows.filter((row) => sameCellValue(row.fields[column] || "", expected));
  const displayColumns = Array.from(new Set(["Row", column, ...Object.keys(matches[0]?.fields || {}).slice(0, 6)])).filter((c) => c !== "Row");
  const sample = matches.slice(0, 20).map((row) => `| ${row.rowNumber} | ${displayColumns.map((c) => markdownCell(row.fields[c] || "")).join(" | ")} |`).join("\n");

  return `Rows where **${column} = ${expected}**: **${matches.length}**\n\n| Row # | ${displayColumns.map(markdownCell).join(" | ")} |\n|---:|${displayColumns.map(() => "---").join("|")}|\n${sample || `| - | ${displayColumns.map(() => "-").join(" | ")} |`}\n\n${matches.length > 20 ? `_Showing first 20 matching rows._\n\n` : ""}📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
}

async function spreadsheetAggregateAnswer(question: string, chunks: RetrievedChunk[], supabase: any, userId: string): Promise<string | null> {
  const q = question.toLowerCase();
  if (!/\b(rows?|columns?|cols?|kitni|kitne|count|total|how many|csv|excel|xlsx|xls|sheet)\b/i.test(q)) return null;
  const candidateDocIds = Array.from(new Set(chunks.filter((c) => /(^|\n)(Row\s+\d+\s*:|## Rows \(structured\)|Total rows:)/i.test(c.content)).map((c) => c.document_id))).slice(0, 2);
  if (!candidateDocIds.length) return spreadsheetAnswerFromRows(question, chunks);

  const { data, error } = await supabase
    .from("document_chunks")
    .select("id,document_id,document_name,content,chunk_index,page_num")
    .eq("user_id", userId)
    .in("document_id", candidateDocIds)
    .order("chunk_index", { ascending: true })
    .limit(5000);
  if (error) {
    console.error("spreadsheet full-row fetch failed:", error.message);
    return spreadsheetAnswerFromRows(question, chunks);
  }
  const allChunks = ((data || []) as any[]).map((row) => ({ ...row, similarity: 0, keywordScore: 0, hybridScore: 0 })) as RetrievedChunk[];
  return spreadsheetAnswerFromRows(question, allChunks.length ? allChunks : chunks);
}

function ordSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// Deterministic Nth-word / Nth-letter solver. Runs BEFORE the LLM so counting
// is exact and stable (LLMs miscount tokens like "his/her" or skip "Q.4").
function positionAnswer(
  question: string,
  chunks: RetrievedChunk[],
  previousUserTurns: string[] = [],
): string | null {
  if (!chunks.length) return null;
  const qOrig = question || "";
  const combined = `${previousUserTurns.join(" \n ")} \n ${qOrig}`.trim();
  const q = qOrig.toLowerCase();
  const cq = combined.toLowerCase();

  // Detect position + unit. Support: "5 word", "8th word", "word 5", "5 letter/alphabet", "5 shabd", "5 akshar".
  let n = 0;
  let unit: "word" | "letter" = "word";
  const m1 = q.match(/\b(\d+)\s*(?:st|nd|rd|th)?\s*(word|shabd|letter|alphabet|character|char|akshar)\b/);
  const m2 = q.match(/\b(word|shabd|letter|alphabet|character|char|akshar)\s*(?:#|number|no\.?)?\s*(\d+)\b/);
  if (m1) { n = parseInt(m1[1], 10); unit = /letter|alphabet|character|char|akshar/.test(m1[2]) ? "letter" : "word"; }
  else if (m2) { n = parseInt(m2[2], 10); unit = /letter|alphabet|character|char|akshar/.test(m2[1]) ? "letter" : "word"; }
  else return null;
  if (!n || n < 1) return null;

  // Detect target descriptor. Look in current + previous turns so short follow-ups work.
  const searchIn = cq;
  const qNum = searchIn.match(/\b(?:q|question|prashn)\.?\s*(\d+)/)?.[1] || null;
  const pointKindMatch = searchIn.match(/\b(point|instruction|step|rule|item|line|para|paragraph)\s*(?:no\.?|number|#)?\s*(\d+)/);
  const pointNum = pointKindMatch?.[2] || null;
  const pointKind = pointKindMatch?.[1] || null;

  const ordered = [...chunks].sort((a, b) => {
    if (a.document_id === b.document_id) return a.chunk_index - b.chunk_index;
    return (b.hybridScore || b.similarity || 0) - (a.hybridScore || a.similarity || 0);
  });
  const context = ordered.map((c) => c.content).join("\n");
  const src = ordered[0];

  let sentence: string | null = null;
  let label = "the target sentence";

  if (qNum) {
    label = `Q.${qNum}`;
    const next = String(parseInt(qNum, 10) + 1);
    const re = new RegExp(
      `(?:^|\\n)\\s*(?:Q\\.?\\s*${qNum}|Question\\s+${qNum})[\\.\\):\\-\\s]+([\\s\\S]*?)(?=\\n\\s*(?:Q\\.?\\s*${next}\\b|Question\\s+${next}\\b)|\\n\\s*\\n|$)`,
      "i",
    );
    const m = context.match(re);
    if (m) sentence = m[1].trim();
    if (!sentence) {
      const any = context.match(new RegExp(`\\b(?:Q\\.?\\s*${qNum}|Question\\s+${qNum})[\\.\\):\\-\\s]+([^\\n]{5,800})`, "i"));
      if (any) sentence = any[1].trim();
    }
  } else if (pointNum && pointKind) {
    label = `${pointKind} ${pointNum}`;
    const next = String(parseInt(pointNum, 10) + 1);
    // Numbered list item: "3. ...", "3) ...", "(3) ..."
    const re = new RegExp(
      `(?:^|\\n)\\s*\\(?${pointNum}[\\.\\)]\\s+([\\s\\S]*?)(?=\\n\\s*\\(?${next}[\\.\\)]\\s|\\n\\s*\\n|$)`,
    );
    const m = context.match(re);
    if (m) sentence = m[1].trim();
  } else {
    return null; // no clear target — let the LLM handle it
  }

  if (!sentence) return null;

  // Keep just the first paragraph/line of the matched item.
  sentence = sentence.split(/\n{2,}/)[0].split(/\n/)[0].trim();
  if (!sentence) return null;

  if (unit === "letter") {
    const clean = sentence.replace(/\s+/g, "");
    if (n > clean.length) {
      return `${label} has only ${clean.length} letters — cannot get letter #${n}.\n\nFull sentence: "${sentence}"\n\n📌 Source: ${src.document_name} | Chunk #${src.chunk_index}`;
    }
    return `The ${n}${ordSuffix(n)} letter of ${label} is "${clean[n - 1]}".\n\nFull sentence: "${sentence}"\n\n📌 Source: ${src.document_name} | Chunk #${src.chunk_index}`;
  }

  // Word tokenize: split on whitespace only. his/her, 40-50, father-in-law stay as ONE token.
  let tokens = sentence.split(/\s+/).filter(Boolean);
  // Drop leading label token: Q.4 | Q4 | Question | 4. | 4) | (4)
  if (tokens.length) {
    if (/^(?:Q\.?\d+|Q\.?|Question|\(?\d+[.)])$/i.test(tokens[0])) tokens = tokens.slice(1);
    // Handle split cases like ["Q.", "4", "Write", ...] or ["Question", "4", "Write", ...]
    if (tokens.length && /^(Q\.?|Question)$/i.test(tokens[0]) && /^\d+[.)]?$/.test(tokens[1] || "")) tokens = tokens.slice(2);
  }
  if (n > tokens.length) {
    return `${label} has only ${tokens.length} words — cannot get word #${n}.\n\nFull sentence: "${sentence}"\n\n📌 Source: ${src.document_name} | Chunk #${src.chunk_index}`;
  }
  const word = tokens[n - 1].replace(/^[",.;:()\[\]]+|[",.;:()\[\]]+$/g, "") || tokens[n - 1];
  const numbered = tokens.map((t, i) => `${i + 1}) ${t}`).join(" ");
  return `The ${n}${ordSuffix(n)} word of ${label} is "${word}".\n\nFull sentence: "${sentence}"\n\nTokens: ${numbered}\n\n📌 Source: ${src.document_name} | Chunk #${src.chunk_index}`;
}

function deterministicFallback(question: string, chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "I could not find a relevant answer in the provided documents.";
  const exact = exactStructuredAnswer(question, chunks);
  if (exact) return exact;
  const q = question.toLowerCase();
  const context = chunks.map((c) => c.content).join("\n");
  const source = chunks[0];

  if (/question\s*paper\s*booklet|booklet\s*no|booklet\s*number/i.test(q)) {
    const match = context.match(/Question\s*Paper\s*Booklet\s*No\.?\s*[:\-]?\s*([A-Za-z0-9]+)/i);
    if (match) return `Question Paper Booklet No. ${match[1]} hai.\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
  }

  if (/\b(q|question)\s*\d+/i.test(q)) {
    const asked = q.match(/\b(?:q|question)\s*(\d+)/i)?.[1];
    if (asked) {
      const re = new RegExp(`(?:^|\\n|\\s)${asked}\\.\\s*([\\s\\S]{80,1400}?)(?=\\n\\s*${Number(asked) + 1}\\.|\\n\\s*\\(${Number(asked) + 1}\\)|$)`, "i");
      const found = context.match(re);
      if (found) return `Q${asked}: ${found[1].trim()}\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
    }
  }

  const best = chunks
    .slice(0, 3)
    .map((c) => `From ${c.document_name} Chunk #${c.chunk_index}:\n${c.content.slice(0, 900).trim()}`)
    .join("\n\n---\n\n");
  return `${best}\n\n📌 Source: ${source.document_name} | Chunk #${source.chunk_index}`;
}

async function saveAssistantResponse(stream: ReadableStream<Uint8Array>, supabase: any, sessionId: string, userId: string) {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (json === "[DONE]") break;
        try {
          const parsed = JSON.parse(json);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) full += delta;
        } catch {}
      }
    }
    if (full.trim()) await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: full, user_id: userId });
  } catch (error) {
    console.error("history save failed:", error);
  }
}

function sseDelta(text: string): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
}

function sseDone(): Uint8Array {
  return new TextEncoder().encode("data: [DONE]\n\n");
}

function isTokenLimitFinish(reason: unknown): boolean {
  return typeof reason === "string" && /^(length|max_tokens|max_output_tokens)$/i.test(reason);
}

async function streamLongFormCompletion({
  baseMessages,
  maxTokens,
  continuationRounds,
  supabase,
  sessionId,
  userId,
}: {
  baseMessages: Message[];
  maxTokens: number;
  continuationRounds: number;
  supabase: any;
  sessionId: string | null;
  userId: string;
}): Promise<Response> {
  let saved = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      let messages = baseMessages;
      try {
        for (let round = 0; round <= continuationRounds; round += 1) {
          const response = await gatewayFetch("/chat/completions", {
            model: CHAT_MODEL,
            messages,
            stream: true,
            temperature: 0,
            max_tokens: maxTokens,
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error("AI gateway continuation error:", response.status, errorText);
            if (!full.trim()) throw new Error(response.status === 429 ? "Rate limits exceeded, please try again later." : response.status === 402 ? "Lovable AI credits exhausted. Please add credits in Workspace Usage." : "AI response failed.");
            controller.enqueue(sseDelta("\n\n⚠️ Response stopped early because the AI call failed while continuing. Please ask 'continue' if you need the rest."));
            break;
          }
          if (!response.body) throw new Error("AI response stream missing");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let tokenLimited = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf("\n")) !== -1) {
              let line = buffer.slice(0, nl);
              buffer = buffer.slice(nl + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (line.startsWith(":")) continue;
              if (!line.startsWith("data: ")) continue;
              const json = line.slice(6).trim();
              if (!json || json === "[DONE]") continue;
              try {
                const parsed = JSON.parse(json);
                const choice = parsed.choices?.[0];
                const delta = choice?.delta?.content as string | undefined;
                if (delta) {
                  full += delta;
                  controller.enqueue(sseDelta(delta));
                }
                if (isTokenLimitFinish(choice?.finish_reason)) tokenLimited = true;
              } catch (error) {
                console.error("SSE parse error:", error);
              }
            }
          }

          if (!tokenLimited) break;
          if (round === continuationRounds) {
            controller.enqueue(sseDelta("\n\n⚠️ Response reached the maximum continuation limit. Ask 'continue from here' for the remaining part."));
            break;
          }

          messages = [
            ...baseMessages,
            { role: "assistant", content: full },
            {
              role: "user",
              content:
                "Continue the previous answer exactly from where it stopped. Do not restart, do not repeat earlier sections, and finish all remaining code/steps/report sections completely.",
            },
          ];
        }

        if (sessionId && full.trim()) {
          const { error } = await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: full, user_id: userId });
          if (error) console.error("history save failed:", error.message);
        }
        saved = true;
        controller.enqueue(sseDone());
        controller.close();
      } catch (error) {
        console.error("long-form stream failed:", error);
        const message = error instanceof Error ? error.message : "AI response failed.";
        if (!saved) controller.enqueue(sseDelta(`⚠️ Error: ${message}`));
        controller.enqueue(sseDone());
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}

const PROMPT_DS = `You are a senior Data Science & ML Engineering assistant.
Generate complete answers, never ending mid-sentence or mid-code.
For coding tasks: provide runnable code, imports, setup assumptions, explanation, edge cases, and validation steps.
If the answer is long, continue until the full solution is complete. Temperature is 0.`;
const PROMPT_RES = `You are an autonomous research agent.
Generate complete structured reports with sub-tasks, findings, comparisons, limitations, and citations/references when available.
Never stop in the middle of a section. If the answer is long, continue until the report is complete. Temperature is 0.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_KEY) throw new Error("LOVABLE_API_KEY missing");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const { messages, mode, sessionId, activeDocumentId } = body || {};
    const safeMessages: Message[] = Array.isArray(messages) ? messages : [];
    const preferredDocId: string | null =
      typeof activeDocumentId === "string" && activeDocumentId ? activeDocumentId : null;
    const userQuery = String(safeMessages[safeMessages.length - 1]?.content || "").trim();

    // Build a context-aware retrieval query: short follow-ups ("and in hindi language mai 4 point",
    // "iska hindi mai", "next point", "aur batao") must inherit the previous user turn(s) so
    // semantic search doesn't lose the topic ("admit card", "point 3", etc.).
    const previousUserTurns = safeMessages
      .slice(0, -1)
      .filter((m) => m.role === "user")
      .slice(-2)
      .map((m) => String(m.content || "").trim())
      .filter(Boolean);
    const wordCount = userQuery.split(/\s+/).filter(Boolean).length;
    const looksLikeFollowup =
      (wordCount <= 10 && /\b(iska|isko|isi|usi|wahi|same|next|previous|pichla|agla|aur|and|hindi|english|translate|anuvad|point|line|paragraph|detail|explain|expand|summarise|summary|short|long)\b/i.test(userQuery)) ||
      /\b(iska|isko|isi|usi|wahi|same|next|previous|pichla|agla|hindi|english|translate|anuvad|point|line|paragraph|detail|explain|expand|summarise|summary|short|long)\b/i.test(
        userQuery,
      );
    const retrievalQuery =
      looksLikeFollowup && previousUserTurns.length > 0
        ? `${previousUserTurns.join(" \n ")} \n ${userQuery}`
        : userQuery;

    if (sessionId && userQuery) {
      await supabase.from("chat_history").insert({ session_id: sessionId, role: "user", message: userQuery, user_id: userId });
    }

    const aiMessages: Message[] = [
      { role: "system", content: mode === "datascience" ? PROMPT_DS : mode === "research" ? PROMPT_RES : strictPrompt() },
    ];

    if (mode === "documents" && userQuery) {
      const variants = Array.from(
        new Set([...buildVariants(retrievalQuery), ...buildVariants(userQuery)]),
      );
      const seen = new Map<string, RetrievedChunk>();

      // Batch all query variants into one embedding call to reduce rate limits and latency.
      const variantEmbeddings = await embedMany(variants);
      const variantResults = await Promise.all(
        variants.map(async (_variant, idx) => {
          const embedding = variantEmbeddings[idx];
          if (!embedding) return [] as RetrievedChunk[];
          const { data, error } = await supabase.rpc("match_document_chunks", {
            query_embedding: JSON.stringify(embedding) as any,
            filter_user_id: userId,
            match_threshold: 0.0,
            match_count: 40,
          });
          if (error) {
            console.error("match_document_chunks failed:", error.message);
            return [] as RetrievedChunk[];
          }
          return (data || []) as RetrievedChunk[];
        }),
      );
      for (const list of variantResults) {
        for (const raw of list) {
          const kScore = keywordScore(userQuery, raw.content);
          const hybridScore = (raw.similarity || 0) * 0.7 + kScore * 0.3;
          const chunk = { ...raw, keywordScore: kScore, hybridScore };
          const prev = seen.get(chunk.id);
          if (!prev || (chunk.hybridScore || 0) > (prev.hybridScore || 0)) seen.set(chunk.id, chunk);
        }
      }

      // Add literal field-match candidates so identity queries like "admit card kis person ka hai"
      // can still find chunks containing "Name / Roll No / Enrollment" even when those exact words are absent.
      const keywordResults = await keywordFallbackSearch(supabase, userQuery, userId);
      for (const raw of keywordResults) {
        const prev = seen.get(raw.id);
        if (!prev || (raw.hybridScore || 0) > (prev.hybridScore || 0)) seen.set(raw.id, raw);
      }
      // Also run keyword fallback on the contextualised query so follow-ups still pull the topic chunks.
      if (retrievalQuery !== userQuery) {
        const ctxResults = await keywordFallbackSearch(supabase, retrievalQuery, userId);
        for (const raw of ctxResults) {
          const prev = seen.get(raw.id);
          if (!prev || (raw.hybridScore || 0) > (prev.hybridScore || 0)) seen.set(raw.id, raw);
        }
      }

      // Re-weight: when numeric tokens present, keyword match matters more than semantic
      const qNumTokens = keywords(userQuery).filter((w) => /\d/.test(w));
      const semanticWeight = qNumTokens.length > 0 ? 0.35 : 0.6;
      const keywordWeight = 1 - semanticWeight;
      for (const c of seen.values()) {
        c.hybridScore = (c.similarity || 0) * semanticWeight + (c.keywordScore || 0) * keywordWeight;
      }
      let chunks = Array.from(seen.values())
        .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))
        .slice(0, 45);

      // Prefer the most recently uploaded / active document. Only fall back to
      // other documents when the active one has nothing relevant at all.
      if (preferredDocId) {
        const preferred = chunks.filter((c) => c.document_id === preferredDocId);
        const hasSignal = preferred.some(
          (c) => (c.hybridScore || 0) > 0.12 || (c.keywordScore || 0) > 0.15 || (c.similarity || 0) > 0.35,
        );
        if (preferred.length > 0 && hasSignal) {
          chunks = preferred;
        } else if (preferred.length === 0) {
          // No hits at all from active doc in vector/keyword search — try a direct
          // scan of that doc's chunks so the user's active document is always tried first.
          const { data: docChunks } = await supabase
            .from("document_chunks")
            .select("id,document_id,document_name,content,chunk_index,page_num")
            .eq("user_id", userId)
            .eq("document_id", preferredDocId)
            .order("chunk_index", { ascending: true })
            .limit(120);
          const scored = ((docChunks || []) as any[])
            .map((row) => {
              const kScore = keywordScore(userQuery, row.content);
              return { ...row, similarity: 0, keywordScore: kScore, hybridScore: kScore } as RetrievedChunk;
            })
            .filter((r) => (r.keywordScore || 0) > 0)
            .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0));
          if (scored.length > 0) chunks = scored.slice(0, 45);
          // else: leave chunks as-is (all-docs fallback)
        }
      }

      chunks = await expandDocumentContext(supabase, userId, chunks, userQuery);

      console.log(
        JSON.stringify({ event: "retrieval", query: userQuery, retrievalQuery, variants, chunks: chunks.length }),
      );

      if (chunks.length > 0) {
        const sheetAnswer = await spreadsheetAggregateAnswer(userQuery, chunks, supabase, userId);
        if (sheetAnswer) {
          if (sessionId) await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: sheetAnswer, user_id: userId });
          return sseTextResponse(sheetAnswer);
        }

        const posAnswer = positionAnswer(userQuery, chunks, previousUserTurns);
        if (posAnswer) {
          if (sessionId) await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: posAnswer, user_id: userId });
          return sseTextResponse(posAnswer);
        }

        const exactAnswer = exactStructuredAnswer(userQuery, chunks);
        if (exactAnswer) {
          if (sessionId) await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: exactAnswer, user_id: userId });
          return sseTextResponse(exactAnswer);
        }

        aiMessages.push({
          role: "system",
          content: `[Context]\n${buildContext(chunks)}\n\n[Conversation so far]\n${previousUserTurns
            .map((q, i) => `User${i + 1}: ${q}`)
            .join("\n")}\n\n[Current User Question]\n${userQuery}\n\n[Instruction]\nThe current question may be a short follow-up — resolve any pronouns/ellipsis using the conversation so far (e.g. "4th point in hindi" means translate the 4th instruction of the same document discussed earlier). Answer using ONLY the context above. If asked to translate or rephrase a specific point/line/paragraph from the document, locate it precisely in the context and produce it. If the context is related but an exact requested field is missing, still answer with the closest exact lines and say what is missing. If truly absent, say "I could not find a relevant answer in the provided documents." End with 📌 citations.`,
        });
      } else {
        aiMessages.push({
          role: "system",
          content: "No relevant chunks retrieved. Reply exactly: I could not find a relevant answer in the provided documents.",
        });
      }
    }

    aiMessages.push(...safeMessages);

    const maxTokens = mode === "datascience" || mode === "research" ? LONG_FORM_MAX_TOKENS : DEFAULT_MAX_TOKENS;
    const continuationRounds = mode === "datascience" || mode === "research" ? LONG_FORM_CONTINUATION_ROUNDS : 0;

    if (mode === "datascience" || mode === "research") {
      // DS Helper and Auto Research often need long code/reports. Proxy the stream so
      // provider [DONE] is only sent after automatic continuation rounds finish.
      return streamLongFormCompletion({
        baseMessages: aiMessages,
        maxTokens,
        continuationRounds,
        supabase,
        sessionId: sessionId || null,
        userId,
      });
    }

    const response = await gatewayFetch("/chat/completions", {
      model: CHAT_MODEL,
      messages: aiMessages,
      stream: true,
      temperature: 0,
      max_tokens: maxTokens,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      if (mode === "documents") {
        const contextMessage = aiMessages.find((m) => m.role === "system" && m.content.startsWith("[Context]"));
        if (contextMessage) {
          const fallbackChunks = Array.from((contextMessage.content.matchAll(/\[Chunk #(\d+) \| File: ([^|]+) \|[^\]]+\]\n([\s\S]*?)(?=\n\n---\n\n\[Chunk #|\n\n\[Conversation so far\]|$)/g)))
            .slice(0, 8)
            .map((m, i) => ({
              id: `fallback-${i}`,
              document_id: "",
              document_name: m[2].trim(),
              chunk_index: Number(m[1]),
              content: m[3].trim(),
              similarity: 0,
            } as RetrievedChunk));
          const fallbackText = deterministicFallback(userQuery, fallbackChunks);
          if (sessionId) await supabase.from("chat_history").insert({ session_id: sessionId, role: "assistant", message: fallbackText, user_id: userId });
          return sseTextResponse(fallbackText);
        }
      }
      const message =
        response.status === 429
          ? "Rate limits exceeded, please try again later."
          : response.status === 402
            ? "Lovable AI credits exhausted. Please add credits in Workspace Usage."
            : "AI response failed.";
      return new Response(JSON.stringify({ error: message }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!response.body) throw new Error("AI response stream missing");

    const [clientStream, historyStream] = response.body.tee();
    if (sessionId) saveAssistantResponse(historyStream, supabase, sessionId, userId);

    return new Response(clientStream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (error) {
    console.error("agent-chat:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
