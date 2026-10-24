import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";
import { EXTRACTED_DIR } from "./store.ts";

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"] as const;
export type SupportedExt = (typeof SUPPORTED_EXTENSIONS)[number];

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

export function isSupported(filename: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(filename));
}

/** Reject anything that is not a text document — explicitly no video/audio. */
export function rejectReason(filename: string): string | null {
  const ext = extensionOf(filename);
  if (!ext) return "File has no extension — only PDF, DOCX, TXT and MD are allowed.";
  if (isSupported(filename)) return null;
  const media = [".mp4", ".mov", ".mkv", ".avi", ".webm", ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"];
  if (media.includes(ext)) {
    return `"${ext}" is a media file. Fundo only accepts PDF, DOCX, TXT and MD — no video or audio.`;
  }
  return `"${ext}" files are not supported. Only PDF, DOCX, TXT and MD.`;
}

// --- TXT ---------------------------------------------------------------

function extractTxt(buf: Uint8Array): string {
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("\uFFFD") && !text.includes("é")) {
    // likely a legacy codepage file; utf16 attempt
    try {
      const utf16 = new TextDecoder("utf-16le", { fatal: true }).decode(buf);
      if (utf16) text = utf16;
    } catch {
      // keep utf8
    }
  }
  return text;
}

// --- DOCX --------------------------------------------------------------

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractDocx(buf: Uint8Array): { text: string; error?: string } {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(new Uint8Array(buf));
  } catch {
    return { text: "", error: "Not a valid DOCX (ZIP) file." };
  }
  const doc = zip["word/document.xml"];
  if (!doc) return { text: "", error: "DOCX is missing word/document.xml." };

  const xml = strFromU8(doc);
  const paragraphs = xml.split(/<\/w:p>/);
  const lines: string[] = [];
  for (const p of paragraphs) {
    let line = p
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n");
    const runs = [...line.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    line = decodeXmlEntities(runs.join(""));
    line = line.replace(/\r/g, "").trimEnd();
    lines.push(line);
  }
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return { text: "", error: "DOCX contained no readable text (scanned image documents are not supported)." };
  return { text };
}

// --- PDF ---------------------------------------------------------------

let pdfjsPromise: Promise<typeof import("npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs")> | null = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs");
      // Run entirely on the main thread (no canvas/web worker needed for text extraction).
      try {
        const worker = await import("npm:pdfjs-dist@4.10.38/legacy/build/pdf.worker.mjs");
        (globalThis as Record<string, unknown>).pdfjsWorker = worker;
      } catch {
        // fall back to pdf.js's internal fake worker
      }
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

async function extractPdf(buf: Uint8Array): Promise<{ text: string; pages: number; error?: string }> {
  const pdfjs = await getPdfjs();
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    }).promise;
  } catch (e) {
    return { text: "", pages: 0, error: `Could not read PDF: ${(e as Error).message}` };
  }
  const parts: string[] = [];
  const numPages = doc.numPages;
  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let pageText = "";
    for (const item of tc.items) {
      if (!("str" in item)) continue;
      pageText += item.str;
      if (item.hasEOL) pageText += "\n";
    }
    pageText = pageText.replace(/[ \t]+\n/g, "\n").trim();
    if (pageText) parts.push(`--- Page ${p} ---\n${pageText}`);
    page.cleanup();
  }
  await doc.destroy();
  const text = parts.join("\n\n").trim();
  if (!text) {
    return {
      text: "",
      pages: numPages,
      error: "No text layer found in this PDF (it may be scanned images, which need OCR that Fundo does not include).",
    };
  }
  return { text, pages: doc.numPages };
}

// --- public API ----------------------------------------------------------

export type ExtractionResult = {
  ok: boolean;
  text: string;
  pages?: number;
  error?: string;
};

export async function extractDocument(filePath: string, fileType: string): Promise<ExtractionResult> {
  let buf: Uint8Array;
  try {
    buf = readFileSync(filePath);
  } catch {
    return { ok: false, text: "", error: "Could not read the uploaded file." };
  }
  if (fileType === ".pdf") {
    const r = await extractPdf(buf);
    return { ok: !r.error, text: r.text, pages: r.pages, error: r.error };
  }
  if (fileType === ".docx") {
    const r = extractDocx(buf);
    return { ok: !r.error, text: r.text, error: r.error };
  }
  if (fileType === ".txt" || fileType === ".md") {
    return { ok: true, text: extractTxt(buf) };
  }
  return { ok: false, text: "", error: "Unsupported file type." };
}

/** Persist extracted text so notes can be re-generated without re-parsing. */
export function saveExtracted(docId: string, text: string): string {
  const path = join(EXTRACTED_DIR, `${docId}.txt`);
  writeFileSync(path, text, "utf8");
  return path;
}

// --- chunking ----------------------------------------------------------

/** Split long text into ~`maxChars` chunks at paragraph/heading boundaries. */
export function chunkText(text: string, maxChars = 12000): string[] {
  if (text.length <= maxChars) return [text];
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let cur = "";
  for (const para of paras) {
    if (para.length > maxChars) {
      // split huge paragraph on sentences
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (cur.length + s.length > maxChars) {
          if (cur) chunks.push(cur);
          cur = "";
        }
        cur += s + " ";
      }
      cur = cur.trim();
      continue;
    }
    if (cur.length + para.length + 2 > maxChars) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + para;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}
