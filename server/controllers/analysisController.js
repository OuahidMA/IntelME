import { asyncHandler } from "../middleware/errorMiddleware.js";
import { improveCv as generateSuggestions, isAIConfigured } from "../services/aiService.js";
import {
  latestAnalysisFor,
  listAnalysesWithResume,
  pruneOldAnalyses,
  requireResume,
  summariseResume,
} from "../services/accountService.js";
import { analyseStoredResume, compareAnalyses } from "../services/documentService.js";
import { scoreVerdict } from "../services/scoringService.js";
import { ValidationError, assertObjectId } from "../utils/validators.js";

/**
 * GET /api/analysis
 *
 * The dashboard landing view: every version with its score, so the client can
 * pick one without a request per card. The resume behind each row is resolved
 * from the account document and inlined, which is what `populate` used to do
 * against a collection.
 */
export const listAnalyses = asyncHandler(async (req, res) => {
  const rows = listAnalysesWithResume(req.user);

  res.json({
    success: true,
    count: rows.length,
    analyses: rows.map(({ analysis, resume }) => ({
      ...analysis.toJSON(),
      resume: summariseResume(resume),
      verdict: scoreVerdict(analysis.score),
    })),
  });
});

/** GET /api/analysis/:resumeId — the full analysis of one CV version. */
export const getAnalysis = asyncHandler(async (req, res) => {
  const resume = requireResume(req.user, req.params.resumeId);
  const analysis = latestAnalysisFor(req.user, resume._id);

  if (!analysis) {
    return res.status(404).json({
      success: false,
      message: "This resume has not been analysed yet.",
    });
  }

  res.json({
    success: true,
    resume: resume.toJSON(),
    analysis: { ...analysis.toJSON(), verdict: scoreVerdict(analysis.score) },
  });
});

/**
 * POST /api/analysis/:resumeId
 *
 * Re-runs the analysis for an already-uploaded file, without asking the user to
 * upload it again. Used after a failed AI call, and by "Improve my CV" refreshes.
 */
export const reanalyse = asyncHandler(async (req, res) => {
  const resume = requireResume(req.user, req.params.resumeId);

  if (!resume.extractedText?.trim()) {
    throw new ValidationError("This resume has no readable text to analyse.");
  }

  const analysis = await analyseStoredResume({ resume, user: req.user });
  await pruneOldAnalyses(req.user, resume._id, analysis._id);

  res.json({
    success: true,
    message: "Analysis refreshed.",
    resume: resume.toJSON(),
    analysis: analysis.toJSON(),
  });
});

/**
 * POST /api/analysis/:resumeId/improve
 *
 * "Improve My CV": rewrites the summary and proposes sharper wording, always
 * returned with the disclaimer that these are suggestions to review.
 */
export const improveCv = asyncHandler(async (req, res) => {
  const resume = requireResume(req.user, req.params.resumeId);
  const analysis = latestAnalysisFor(req.user, resume._id);

  if (!analysis) {
    throw new ValidationError("Analyse this resume before asking for improvements.");
  }

  if (!isAIConfigured()) {
    const error = new Error(
      "AI is not configured on the server. Add GROQ_API_KEY to server/.env.",
    );
    error.status = 503;
    throw error;
  }

  const improvements = await generateSuggestions({
    profile: analysis.profile,
    weaknesses: analysis.weaknesses,
    recommendations: analysis.recommendations,
  });

  // Persisted against the analysis so the dashboard can show it without
  // re-spending an API call on every page load.
  analysis.improvements = improvements;
  await req.user.save();

  res.json({
    success: true,
    message: "Suggestions generated. They are AI recommendations — review every line.",
    improvements,
    analysis: analysis.toJSON(),
  });
});

/**
 * POST /api/analysis/compare
 *
 * Body: { resumeIds: string[] } — two or more versions of the caller's CV.
 * Returns one row per metric with a column per version, plus the version that
 * wins each row.
 */
export const compareVersions = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.resumeIds) ? req.body.resumeIds : [];
  const unique = [...new Set(ids.map((id) => assertObjectId(id, "resume id")))];

  if (unique.length < 2) {
    throw new ValidationError("Select at least two CV versions to compare.");
  }
  if (unique.length > 5) {
    throw new ValidationError("You can compare up to five versions at a time.");
  }

  // Only entries inside this account document are reachable, so an id from
  // another account simply does not resolve.
  const wanted = new Set(unique);
  const analyses = listAnalysesWithResume(req.user).filter(({ analysis }) =>
    wanted.has(String(analysis.resume)),
  );

  if (analyses.length < 2) {
    const error = new Error("Two of the selected versions have no analysis yet.");
    error.status = 409;
    throw error;
  }

  const versions = analyses.map(({ analysis, resume }) => ({
    id: String(analysis._id),
    resumeId: String(analysis.resume),
    label: resume?.label ?? "Main",
    originalName: resume?.originalName ?? "",
    score: analysis.score,
    createdAt: resume?.createdAt ?? analysis.createdAt,
  }));

  const rows = compareAnalyses(analyses.map(({ analysis }) => analysis));

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
    versions,
    rows: withLeaders,
    winner: versions[winnerIndex] ?? null,
  });
});
