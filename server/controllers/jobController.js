import { asyncHandler } from "../middleware/errorMiddleware.js";
import {
  clearJobs,
  listJobMatches,
  pushJob,
  removeJob,
  requireAnalysis,
  requireJob,
} from "../services/accountService.js";
import { matchJobToDescription, toMatchProfile } from "../services/aiService.js";
import { matchVerdict, scoreJobMatch, summariseMatch } from "../services/matchingService.js";
import {
  assertObjectId,
  parseCursor,
  parseScoreRange,
  parseSort,
  validateJobDescription,
} from "../utils/validators.js";

/** Sort keys the "My job matches" list accepts, mapped to real fields. */
const SORTABLE = {
  date: "createdAt",
  score: "score",
  title: "jobTitle",
  company: "company",
};

/**
 * POST /api/jobs/match
 *
 * Body: { resumeId, jobDescription, jobTitle?, company? }
 *
 * Sends `PROMPT_JOB_MATCH` to Groq with the stored analysis, then scores the
 * result with the weighted formula so the total always matches the breakdown.
 * The match is stored in the account document next to the analysis it came from.
 */
export const createMatch = asyncHandler(async (req, res) => {
  const { resume, analysis } = requireAnalysis(req.user, req.body?.resumeId);
  const { jobDescription, jobTitle, company } = validateJobDescription(req.body);

  const aiResult = await matchJobToDescription({
    profile: toMatchProfile(analysis),
    jobDescription,
  });

  const { score, breakdown, matchingSkills, missingSkills, matchingExperience, explain } =
    scoreJobMatch({ result: aiResult, analysis });

  const job = await pushJob(req.user, {
    resume: resume._id,
    analysis: analysis._id,
    jobTitle: jobTitle || aiResult.jobTitle,
    company: company || aiResult.company,
    jobDescription,
    score,
    scoreBreakdown: breakdown,
    verdict: aiResult.verdict || matchVerdict(score),
    summary: aiResult.summary,
    matchingSkills,
    missingSkills,
    matchingExperience,
    missingExperience: aiResult.missingExperience,
    matchingEducation: aiResult.matchingEducation,
    matchingProjects: aiResult.matchingProjects,
    missingProjects: aiResult.missingProjects,
    matchingKeywords: aiResult.matchingKeywords,
    missingKeywords: aiResult.missingKeywords,
    matchingCertifications: aiResult.matchingCertifications,
    missingCertifications: aiResult.missingCertifications,
    strengths: explain.strengths,
    gaps: explain.gaps,
    recommendations: explain.recommendations,
    createdAt: new Date(),
  });

  res.status(201).json({
    success: true,
    message: "Match scored.",
    match: job.toJSON(),
  });
});

/**
 * GET /api/jobs
 *
 * "My job matches": sortable (`?sort=score:desc`, `?sort=date:asc`) and
 * filterable (`?min=60&max=90`, `?resumeId=…`), applied in memory to the matches
 * held in the account document.
 */
export const listMatches = asyncHandler(async (req, res) => {
  const sort = parseSort(req.query.sort, SORTABLE, { createdAt: -1 });
  const scoreRange = parseScoreRange(req.query) ?? {};

  const matches = listJobMatches(req.user, {
    // Validated rather than coerced: a malformed version id is a bad request,
    // not a request that happens to match nothing.
    resumeId: req.query.resumeId ? assertObjectId(req.query.resumeId, "resume id") : null,
    search: req.query.search,
    min: scoreRange.$gte,
    max: scoreRange.$lte,
    sort,
    limit: req.query.limit,
    cursor: parseCursor(req.query.cursor),
  });

  res.json({
    success: true,
    count: matches.length,
    sort,
    matches: matches.map(summariseMatch),
  });
});

/** GET /api/jobs/:id — the full match, including the breakdown and the "why". */
export const getMatch = asyncHandler(async (req, res) => {
  const job = requireJob(req.user, req.params.id);

  res.json({
    success: true,
    match: job.toJSON(),
  });
});

/** DELETE /api/jobs/:id — remove one entry from the history. */
export const deleteMatch = asyncHandler(async (req, res) => {
  await removeJob(req.user, req.params.id);

  res.json({ success: true, message: "Job match deleted." });
});

/** DELETE /api/jobs — clear the whole history. */
export const clearMatches = asyncHandler(async (req, res) => {
  const deleted = await clearJobs(req.user);

  res.json({ success: true, message: `Deleted ${deleted} job match(es).` });
});
