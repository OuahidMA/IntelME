import { randomUUID } from "node:crypto";

import { getExtension } from "../middleware/uploadMiddleware.js";
import { ValidationError } from "../utils/validators.js";
import { analyseResume, isAIConfigured, AIServiceError } from "./aiService.js";
import { scoreResume, scoreVerdict } from "./scoringService.js";

/**
 * The resume pipeline.
 *
 *   read file -> recover text (embedded layer, then OCR) -> send it to Groq for
 *              structured JSON -> score it -> hand both back
 *
 * Nothing here writes. That is the whole design: the account document holds a
 * name, an email and a password hash, and every CV the user has ever uploaded
 * lives in their browser instead. The server's only job is the part a browser
 * cannot do — read a PDF, OCR a scan, and call the model — and it does that work
 * on a temporary file it deletes before it answers.
 *
 * So there is no "resume" model and no "analysis" model. There is a pipeline and
 * a pair of plain, JSON-safe objects.
 */

/** The score-derived fixes lead, because they reflect the number being judged on. */
const mergeUnique = (...lists) => {
  const seen = new Set();
  const merged = [];

  for (const list of lists) {
    for (const entry of list ?? []) {
      if (!entry || seen.has(entry)) continue;
      seen.add(entry);
      merged.push(entry);
    }
  }

  return merged;
};

/**
 * The plain description of a file that has just been parsed.
 *
 * There is deliberately no id and no path. The browser names the version — it is
 * the thing that has to be able to refer to it across reloads — and the path is
 * unlinked by the caller the moment this function returns.
 *
 * @param {object} params
 * @param {import("express").Request["file"]} params.file  the multer upload
 * @param {string} params.label  the user-facing version label
 * @param {string} params.text  the recovered plain text
 * @param {string} params.method  how the text was recovered
 * @param {number} params.chars  length of the recovered text
 */
export function buildResumeRecord({ file, label = "Main", text = "", method = "", chars = 0 }) {
  return {
    originalName: file.originalname,
    fileType: getExtension(file.originalname),
    fileSize: file.size ?? 0,
    label,
    extractionMethod: method,
    characters: chars,
    extractedText: text,
    createdAt: new Date(),
  };
}

/**
 * Sends recovered text to Groq and scores the result.
 *
 * The score is computed here from the structured data, not taken from the model,
 * so the number the candidate sees is always reproducible from the breakdown that
 * sits next to it.
 *
 * @param {object} params
 * @param {string} params.text  the plain text recovered from the file
 * @returns {Promise<object>} a JSON-safe analysis, minted fresh on every call
 */
export async function buildAnalysis({ text }) {
  if (!text?.trim()) {
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
    structured = await analyseResume(text);
  } catch (error) {
    if (error instanceof AIServiceError) throw error;
    throw new AIServiceError("The AI analysis could not be completed.", { cause: error });
  }

  const { score, breakdown, strengths, weaknesses, recommendations } = scoreResume({
    analysis: structured,
    rawText: text,
  });

  return {
    id: randomUUID(),
    createdAt: new Date(),
    score,
    verdict: scoreVerdict(score),
    scoreBreakdown: breakdown,
    ...structured,
    // The AI's qualitative read is kept alongside the deterministic one, so a
    // good suggestion the model found is never thrown away in favour of ours.
    strengths: mergeUnique(strengths, structured.strengths).slice(0, 10),
    weaknesses: mergeUnique(weaknesses, structured.weaknesses).slice(0, 10),
    recommendations: mergeUnique(recommendations, structured.recommendations).slice(0, 12),
    // Filled in by the "Improve my CV" endpoint and written back by the browser.
    improvements: null,
  };
}

/**
 * Side-by-side metrics for two or more CV versions, used by the comparison view.
 *
 * The rows are the match categories plus the CV categories that mean something
 * across versions (structure and keywords especially), so the table answers
 * "which version reads better?" rather than only "which scores higher?".
 *
 * Values are read by position rather than by id: the browser holds these
 * analyses and there is nothing guaranteeing they were minted with one.
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

  const breakdowns = analyses.map(
    (analysis) => new Map((analysis?.scoreBreakdown ?? []).map((row) => [row.key, row.score])),
  );

  const rows = metrics.map((metric) => ({
    metric: metric.key,
    label: metric.label,
    values: analyses.map((analysis, index) => {
      if (metric.key === "keywords") {
        // Not a scored CV category: measure keyword volume directly.
        return Math.min(100, ((analysis?.keywords?.length ?? 0) / 20) * 100);
      }

      return breakdowns[index].get(metric.key) ?? 0;
    }),
  }));

  rows.push({
    metric: "overall",
    label: "Overall",
    values: analyses.map((analysis) => analysis?.score ?? 0),
  });

  return rows;
}

export { scoreVerdict };
export default buildAnalysis;