import fs from "node:fs/promises";

import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";

/**
 * Recovers plain text from an uploaded resume.
 *
 * Two strategies, because a PDF is not one thing:
 *   1. Embedded text layer — fast and exact. Used when the PDF carries real text.
 *   2. OCR — for scanned pages and image-only documents, where step 1 returns
 *      almost nothing. Pages are rasterised with pdf-parse's bundled canvas and
 *      read with Tesseract.
 *
 * .docx is a zip of XML, so mammoth reads it directly with no OCR step.
 *
 * This vocabulary lives here rather than in a model because nothing here is
 * persisted any more: the method is a property of the parse that just happened,
 * reported to the browser alongside the text, and there is no document to hang a
 * `status` or a stored `extractionMethod` field on.
 */

/** How the text was recovered from the file. */
export const EXTRACTION_METHOD = {
  TEXT: "text",
  OCR: "ocr",
  HYBRID: "hybrid",
  FAILED: "failed",
};

/** Below this many letters we assume the document is a scan, not real text. */
const OCR_FALLBACK_THRESHOLD = 200;

/** A document needs at least this many letters to be worth analysing. */
const MIN_MEANINGFUL_LETTERS = 20;

/** How many pages to rasterise when OCR-ing, to bound CPU and memory. */
const MAX_OCR_PAGES = 5;

/** Tesseract renders at 150 DPI equivalent — enough for clean CV text. */
const OCR_RENDER_SCALE = 2.2;

/**
 * pdf-parse separates pages with a "-- 2 of 3 --" marker. Left in place it
 * becomes a "document" consisting only of punctuation, which then passes a naive
 * emptiness check and gets sent to the model as if it were CV content.
 */
const PAGE_MARKER = /^\s*-{2,}\s*\d+\s+of\s+\d+\s*-{2,}\s*$/gm;

export class ExtractionError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "ExtractionError";
    this.status = 422;
    this.cause = cause;
  }
}

/** Collapses layout noise: soft hyphens, non-breaking spaces, runs of blanks. */
export function normaliseText(text) {
  if (typeof text !== "string") return "";

  return text
    .replace(PAGE_MARKER, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00ad/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Counts characters that carry meaning. A page of digits, dashes and bullets
 * scores zero, so a failed extraction cannot masquerade as a short CV.
 */
export function countMeaningfulLetters(text) {
  return (String(text ?? "").match(/[a-z]/gi) ?? []).length;
}

async function readBuffer(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (cause) {
    throw new ExtractionError("The uploaded file could not be read.", { cause });
  }
}

/** Step 1: the text layer a PDF already contains. */
async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    return normaliseText(result?.text ?? "");
  } finally {
    // Releases the pdf.js worker — skipping this leaks a handle per upload.
    await parser.destroy().catch(() => {});
  }
}

/** Step 2: rasterise pages and read them with Tesseract. */
async function ocrPdfPages(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let worker;

  try {
    const screenshots = await parser.getScreenshot({
      first: MAX_OCR_PAGES,
      scale: OCR_RENDER_SCALE,
    });

    const pages = screenshots?.pages ?? [];
    if (pages.length === 0) return "";

    worker = await createWorker("eng");

    const chunks = [];
    for (const page of pages) {
      const { data } = await worker.recognize(page.data);
      const text = normaliseText(data?.text ?? "");

      if (text) chunks.push(text);
    }

    return chunks.join("\n\n");
  } finally {
    await worker?.terminate().catch(() => {});
    await parser.destroy().catch(() => {});
  }
}

async function extractDocxText(buffer) {
  const result = await mammoth.extractRawText({ buffer });

  return normaliseText(result?.value ?? "");
}

async function ocrImageBuffer(buffer) {
  const worker = await createWorker("eng");

  try {
    const { data } = await worker.recognize(buffer);
    return normaliseText(data?.text ?? "");
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/**
 * Entry point used by the resume controller.
 *
 * @param {{filePath: string, fileType: "pdf"|"docx", originalName?: string}} file
 * @returns {Promise<{text: string, method: string, pages?: number, chars: number}>}
 */
export async function extractResumeText({ filePath, fileType }) {
  const buffer = await readBuffer(filePath);
  let text = "";
  let method = EXTRACTION_METHOD.TEXT;

  if (fileType === "docx") {
    try {
      text = await extractDocxText(buffer);
    } catch (cause) {
      throw new ExtractionError(
        "That .docx file could not be parsed. Try re-saving it as a fresh .docx.",
        { cause },
      );
    }
  } else {
    try {
      text = await extractPdfText(buffer);
    } catch (cause) {
      console.warn("[ocr] embedded PDF text failed, falling back to OCR:", cause.message);
    }

    // A scan yields only a handful of stray glyphs, so a short result means
    // "no real text layer" — exactly the case OCR exists for.
    if (countMeaningfulLetters(text) < OCR_FALLBACK_THRESHOLD) {
      console.info("[ocr] text layer thin, running OCR");

      try {
        const ocrText = await ocrPdfPages(buffer);

        if (countMeaningfulLetters(ocrText) > countMeaningfulLetters(text)) {
          text = ocrText;
          method = EXTRACTION_METHOD.OCR;
        }
      } catch (cause) {
        console.error("[ocr] OCR failed:", cause.message);
        // Fall through: whatever text we have is better than failing outright.
      }
    }
  }

  if (countMeaningfulLetters(text) < MIN_MEANINGFUL_LETTERS) {
    throw new ExtractionError(
      "No readable text was found in that file. If it is a scan, make sure it is sharp and the text is not rotated.",
    );
  }

  return {
    text,
    method,
    chars: text.length,
  };
}

export { OCR_FALLBACK_THRESHOLD, MIN_MEANINGFUL_LETTERS, ocrImageBuffer };
export default extractResumeText;
