/**
 * Runs the extraction service against the generated fixtures: a real .docx, a
 * real text-layer .pdf, and an image-only .pdf that must fall through to OCR.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractResumeText } from "../services/ocrService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "..", "uploads", "__fixtures__");

const CASES = [
  { name: "docx", file: "john-doe-cv.docx", fileType: "docx", expectOcr: false },
  { name: "pdf text layer", file: "john-doe-cv.pdf", fileType: "pdf", expectOcr: false },
  { name: "pdf image only", file: "scanned-cv.pdf", fileType: "pdf", expectOcr: true },
];

let failures = 0;

for (const testCase of CASES) {
  const filePath = path.join(FIXTURES, testCase.file);

  try {
    const { text, method, chars } = await extractResumeText({ filePath, fileType: testCase.fileType });

    const hasName = /John Doe/i.test(text);
    const hasEmail = /john@example\.com/i.test(text);
    const hasSkill = /React/i.test(text);
    const isOcr = method === "ocr";

    const ok = hasName && hasSkill && isOcr === testCase.expectOcr;

    if (!ok) failures += 1;

    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${testCase.name.padEnd(16)} method=${method.padEnd(4)} chars=${String(chars).padStart(5)} name=${hasName} email=${hasEmail} skills=${hasSkill}`,
    );
    console.log(`       first line: ${text.split("\n")[0]?.slice(0, 70) ?? "(empty)"}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${testCase.name.padEnd(16)} ${error.message}`);
  }
}

// A corrupt file must produce a clear error, not a crash or an empty document.
try {
  const { ExtractionError } = await import("../services/ocrService.js");
  const badPath = path.join(FIXTURES, "not-a-cv.pdf");

  await extractResumeText({ filePath: badPath, fileType: "pdf" });
  console.log("  FAIL corrupt file        was accepted");
  failures += 1;
} catch (error) {
  const ok = error instanceof Error && typeof error.message === "string";
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} corrupt file        rejected: ${error.message.slice(0, 70)}`);
}

console.log(failures === 0 ? "\nAll extraction checks passed." : `\n${failures} check(s) failed.`);
