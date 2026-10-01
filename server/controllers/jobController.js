import { randomUUID } from "node:crypto";

import { asyncHandler } from "../middleware/errorMiddleware.js";
import { matchJobToDescription, toMatchProfile } from "../services/aiService.js";
import { matchVerdict, scoreJobMatch } from "../services/matchingService.js";
import { validateMatchRequest } from "../utils/validators.js";

/**
 * POST /api/jobs/match
 *
 * Body: { analysis, resumeId?, jobDescription, jobTitle?, company? }
 *
 * Scores a pasted job description against an analysis the browser kept from an
 * earlier call. Sends `PROMPT_JOB_MATCH` to Groq with the candidate side of the
 * comparison, then scores the result with the weighted formula so the total
 * always matches the breakdown.
 *
 * The match is returned, not stored. The browser is the only place it exists,
 * which is why `analysis` travels in the request body rather than being read from
 * an account: the server has nothing to read it from.
 */
export const createMatch = asyncHandler(async (req, res) => {
  const { analysis, resumeId, jobDescription, jobTitle, company } = validateMatchRequest(req.body);

  const aiResult = await matchJobToDescription({
    profile: toMatchProfile(analysis),
    jobDescription,
  });

  const { score, breakdown, matchingSkills, missingSkills, matchingExperience, explain } =
    scoreJobMatch({ result: aiResult, analysis });

  const match = {
    id: randomUUID(),
    createdAt: new Date(),
    resumeId,
    jobTitle: jobTitle || aiResult.jobTitle,
    company: company || aiResult.company,
    jobDescription,
    score,
    verdict: aiResult.verdict || matchVerdict(score),
    summary: aiResult.summary,
    scoreBreakdown: breakdown,
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
  };

  res.status(201).json({
    success: true,
    message: "Match scored.",
    match,
  });
});