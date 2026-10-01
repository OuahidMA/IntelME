import { asyncHandler } from "../middleware/errorMiddleware.js";
import { improveCv as generateSuggestions, isAIConfigured } from "../services/aiService.js";
import { buildAnalysis, compareAnalyses } from "../services/documentService.js";
import { validateCompareRequest, validateImproveRequest, validateResumeText } from "../utils/validators.js";

/**
 * Every endpoint here takes the CV's data as input and returns a result. None of
 * them reads anything back: the browser holds the text and the analysis, and
 * sends whichever of them the call needs.
 */

/** POST /api/analysis — re-runs the analysis on text the browser already holds. */
export const analyseText = asyncHandler(async (req, res) => {
  const { text } = validateResumeText(req.body);

  const analysis = await buildAnalysis({ text });

  res.json({
    success: true,
    message: "Analysis refreshed.",
    analysis,
  });
});

/**
 * POST /api/analysis/improve
 *
 * "Improve My CV": rewrites the summary and proposes sharper wording, always
 * returned with the disclaimer that these are suggestions to review.
 *
 * The previous version of this endpoint read the weaknesses out of a stored
 * analysis. It cannot do that any more — there is no stored analysis — so the
 * browser sends them, and the response is not persisted either.
 */
export const improveCv = asyncHandler(async (req, res) => {
  const { profile, weaknesses, recommendations } = validateImproveRequest(req.body);

  if (!isAIConfigured()) {
    const error = new Error(
      "AI is not configured on the server. Add GROQ_API_KEY to server/.env.",
    );
    error.status = 503;
    throw error;
  }

  const improvements = await generateSuggestions({ profile, weaknesses, recommendations });

  res.json({
    success: true,
    message: "Suggestions generated. They are AI recommendations — review every line.",
    improvements,
  });
});

/**
 * POST /api/analysis/compare
 *
 * Body: { versions: [{ resumeId, label, originalName, createdAt, analysis }] }
 *
 * Returns one row per metric with a column per version, plus the version that
 * wins each row. The arithmetic lives here, beside the scoring it reads, rather
 * than being duplicated in the browser.
 */
export const compareVersions = asyncHandler(async (req, res) => {
  const versions = validateCompareRequest(req.body);
  const analyses = versions.map((version) => version.analysis);

  const rows = compareAnalyses(analyses);

  // Mark the leader on each row so the client does not have to compute it.
  const withLeaders = rows.map((row) => {
    const best = Math.max(...row.values);
    const worst = Math.min(...row.values);

    return {
      ...row,
      best: row.values.map((value) => value === best),
      worst: row.values.map((value) => value === worst && best !== worst),
    };
  });

  const overallRow = withLeaders.find((row) => row.metric === "overall");
  const winnerIndex = overallRow?.values.indexOf(Math.max(...overallRow.values)) ?? 0;

  res.json({
    success: true,
    versions: versions.map((version, index) => ({
      resumeId: version.resumeId,
      label: version.label,
      originalName: version.originalName,
      score: analyses[index].score,
      createdAt: version.createdAt,
    })),
    rows: withLeaders,
    winner: {
      resumeId: versions[winnerIndex]?.resumeId ?? "",
      label: versions[winnerIndex]?.label ?? "Main",
      score: analyses[winnerIndex]?.score ?? 0,
    },
  });
});