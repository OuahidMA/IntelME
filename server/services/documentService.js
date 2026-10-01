import { EXTRACTION_METHOD, RESUME_STATUS } from "../models/Resume.js";
import { analyseResume, isAIConfigured, AIServiceError } from "./aiService.js";
import { extractResumeText, ExtractionError } from "./ocrService.js";
import { scoreResume, scoreVerdict } from "./scoringService.js";
import { getExtension } from "../middleware/uploadMiddleware.js";
import { pushAnalysis, pushResume } from "./accountService.js";
import { ValidationError } from "../utils/validators.js";

/**
 * The resume pipeline.
 *
 *   upload -> store file -> extract text (embedded layer, then OCR) -> persist
 *          -> send to Groq for structured JSON -> score it -> persist analysis
 *
 * Every step writes its own status onto the resume, so a failure halfway through
 * is visible on the dashboard instead of looking like a hang.
 *
 * Both steps take the signed-in account document and save their result into it,
 * so a CV, its analysis and the job matches derived from them all live in the
 * same `users` document. Mongoose persists only the element that changed, so
 * these saves stay proportional to what actually moved rather than to the size
 * of the account.
 */

/**
 * Step 1-2: persist the uploaded file and recover its text.
 *
 * @param {object} params
 * @param {import("mongoose").Document} params.user the account to nest the resume in
 * @returns {Promise<import("mongoose").Document>} the stored Resume subdocument
 */
export async function ingestResume({ user, file, label = "Main" }) {
  if (!file) {
    throw new ValidationError("No file was uploaded.");
  }

  const fileType = getExtension(file.originalname);

  // The download URL needs the resume id, and Mongoose assigns that when the
  // subdocument is pushed, so both go in with a single write. The placeholder
  // below never leaves the server.
  const resume = await pushResume(user, {
    originalName: file.originalname,
    fileType,
    // Download goes through an authenticated route, never a public static path.
    fileUrl: "/api/resumes/pending/file",
    filePath: file.path,
    fileSize: file.size ?? 0,
    label,
    status: RESUME_STATUS.PROCESSING,
    createdAt: new Date(),
  });

  resume.fileUrl = `/api/resumes/${resume._id}/file`;
  await user.save();

  try {
    const { text, method, chars } = await extractResumeText({
      filePath: file.path,
      fileType,
    });

    resume.extractedText = text;
    resume.extractionMethod = method;
    resume.status = RESUME_STATUS.COMPLETED;
    resume.error = null;
    await user.save();

    console.info(
      `[doc] ${resume.originalName}: ${chars} chars via ${method} (${method === EXTRACTION_METHOD.OCR ? "OCR" : "text layer"})`,
    );

    return resume;
  } catch (error) {
    resume.status = RESUME_STATUS.FAILED;
    resume.error = error.message?.slice(0, 300) ?? "Text extraction failed.";
    await user.save();

    // A file we cannot read is useless to the user; stop here rather than
    // handing an empty document to the model.
    if (error instanceof ExtractionError) throw error;

    throw new ExtractionError("The file could not be read. Try exporting a fresh PDF or DOCX.");
  }
}

/**
 * Step 3-4: send the extracted text to Groq, score the result, persist it.
 *
 * @param {object} params
 * @param {import("mongoose").Document} params.resume the stored Resume subdocument
 * @param {import("mongoose").Document} params.user  the account to nest the analysis in
 * @returns {Promise<import("mongoose").Document>} the created Analysis subdocument
 */
export async function analyseStoredResume({ resume, user }) {
  if (!resume?.extractedText?.trim()) {
    throw new ValidationError("This resume has no readable text to analyse.");
  }

  if (!isAIConfigured()) {
    throw new AIServiceError(
      "AI analysis is not configured on the server. Add GROQ_API_KEY to server/.env.",
      { status: 503 },
    );
  }

  let structured;

  try {
    structured = await analyseResume(resume.extractedText);
  } catch (error) {
    if (error instanceof AIServiceError) throw error;
    throw new AIServiceError("The AI analysis could not be completed.", { cause: error });
  }

  // The score is computed from the structured data, not taken from the model,
  // so it can be recomputed and audited at any time.
  const { score, breakdown, strengths, weaknesses, recommendations } = scoreResume({
    analysis: structured,
    rawText: resume.extractedText,
  });

  const analysis = await pushAnalysis(user, {
    resume: resume._id,
    score,
    scoreBreakdown: breakdown,
    ...structured,
    // The AI's qualitative read is kept alongside the deterministic one; the
    // dashboard shows the union so a good suggestion is never thrown away.
    // The score-derived fixes lead, because they always reflect the number the
    // candidate is actually being judged on.
    strengths: [...new Set([...strengths, ...(structured.strengths ?? [])])].slice(0, 10),
    weaknesses: [...new Set([...weaknesses, ...(structured.weaknesses ?? [])])].slice(0, 10),
    recommendations: [...new Set([...(recommendations ?? []), ...(structured.recommendations ?? [])])].slice(
      0,
      12,
    ),
    createdAt: new Date(),
  });

  return analysis;
}

/** Full pipeline for a single upload. */
export async function processResumeUpload({ user, file, label }) {
  const resume = await ingestResume({ user, file, label });
  const analysis = await analyseStoredResume({ resume, user });

  return { resume, analysis };
}

/**
 * Side-by-side metrics for two or more CV versions, used by the comparison view.
 *
 * The rows are the match categories plus the CV categories that mean something
 * across versions (structure and keywords especially), so the table answers
 * "which version reads better?" rather than only "which scores higher?".
 */
export function compareAnalyses(analyses) {
  const metrics = [
    { key: "skills", label: "Skills" },
    { key: "summary", label: "Summary" },
    { key: "experience", label: "Experience" },
    { key: "education", label: "Education" },
    { key: "projects", label: "Projects" },
    { key: "certifications", label: "Certifications" },
    { key: "structure", label: "Structure" },
    { key: "keywords", label: "Keywords" },
  ];

  const breakdownOf = new Map(
    analyses.map((analysis) => [String(analysis.id ?? analysis._id), new Map(
      (analysis.scoreBreakdown ?? []).map((row) => [row.key, row.score]),
    )]),
  );

  const rows = metrics.map((metric) => ({
    metric: metric.key,
    label: metric.label,
    values: analyses.map((analysis) => {
      const id = String(analysis.id ?? analysis._id);

      if (metric.key === "keywords") {
        // Not a scored CV category: measure keyword volume directly.
        return Math.min(100, ((analysis.keywords?.length ?? 0) / 20) * 100);
      }

      return breakdownOf.get(id)?.get(metric.key) ?? 0;
    }),
  }));

  rows.push({
    metric: "overall",
    label: "Overall",
    values: analyses.map((analysis) => analysis.score),
  });

  return rows;
}

export { scoreVerdict };
export default processResumeUpload;
