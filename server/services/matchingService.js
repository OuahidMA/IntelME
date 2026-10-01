import { totalExperienceYears } from "../utils/dates.js";

/**
 * The job-match score.
 *
 * As with the CV score, the arithmetic happens here and not in the model. The AI
 * decides *what* matches and *why*; this file decides how much that is worth, so
 * the published total is always reproducible from the published breakdown.
 *
 * Weights are fixed by the product spec and sum to exactly 100.
 */

export const MATCH_WEIGHTS = {
  skills: { key: "skills", label: "Skills", weight: 40 },
  experience: { key: "experience", label: "Experience", weight: 25 },
  education: { key: "education", label: "Education", weight: 10 },
  projects: { key: "projects", label: "Projects", weight: 10 },
  keywords: { key: "keywords", label: "Keywords", weight: 10 },
  certifications: { key: "certifications", label: "Certifications", weight: 5 },
};

const clamp = (value) => Math.min(100, Math.max(0, Math.round(value)));

function ramp(value, from, to) {
  if (to === from) return value >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

/**
 * Collapses the naming differences between a CV and a posting, so "React.js",
 * "React" and "reactjs" compare equal, and "REST APIs" matches "REST API".
 */
const SKILL_ALIASES = new Map(
  Object.entries({
    "react.js": "react",
    reactjs: "react",
    "node.js": "node",
    nodejs: "node",
    "next.js": "next",
    nextjs: "next",
    "vue.js": "vue",
    vuejs: "vue",
    "rest api": "rest",
    "rest apis": "rest",
    "restful api": "rest",
    "restful apis": "rest",
    apis: "rest",
    javascript: "javascript",
    js: "javascript",
    ts: "typescript",
    "google cloud platform": "gcp",
    "amazon web services": "aws",
    "microsoft azure": "azure",
    mongodb: "mongodb",
    mongo: "mongodb",
    postgres: "postgresql",
    "postgre sql": "postgresql",
    ci: "ci/cd",
    "ci-cd": "ci/cd",
    cd: "ci/cd",
    "machine learning": "machine learning",
    ml: "machine learning",
    "unit testing": "testing",
    "git version control": "git",
    versioncontrol: "git",
    "tailwind css": "tailwind",
    tailwindcss: "tailwind",
    "graphql api": "graphql",
    "graph ql": "graphql",
  }),
);

const NOISE_PREFIXES = /(?:strong|excellent|good|great|solid|proven|expert|advanced|intermediate|basic|excellent|strong)\s+/i;

export function normaliseSkill(value) {
  const base = String(value ?? "")
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(NOISE_PREFIXES, "")
    .trim();

  if (!base) return "";

  return SKILL_ALIASES.get(base) ?? base;
}

/** Deduplicated list of normalised skill keys from the candidate's CV. */
function candidateSkillKeys(analysis) {
  return new Set(
    (analysis?.skills ?? [])
      .map((skill) => normaliseSkill(skill?.name))
      .filter(Boolean),
  );
}

/**
 * Cross-checks the AI's matching list against the candidate's actual skills.
 *
 * If the model claims a skill that is not in the extracted data we keep the row
 * (it may have seen it in the summary) but flag it in the note, so the table can
 * be read as evidence rather than as an assertion.
 */
function scoreSkillsCategory({ result, analysis }) {
  const candidateKeys = candidateSkillKeys(analysis);
  const matched = result.matchingSkills ?? [];
  const missing = result.missingSkills ?? [];

  // Anything the model listed as missing but the CV actually contains is a false
  // gap and would unfairly depress the score.
  const falseGaps = missing.filter((gap) => candidateKeys.has(normaliseSkill(gap.name)));
  const trueGaps = missing.filter((gap) => !candidateKeys.has(normaliseSkill(gap.name)));

  const verifiedMatches = matched.filter((row) => candidateKeys.has(normaliseSkill(row.name)));

  const total = matched.length + trueGaps.length;

  if (total === 0) {
    return {
      score: candidateKeys.size > 0 ? 50 : 0,
      // Still the *filtered* list: if every reported gap turned out to be on the
      // CV, the honest answer is "no gaps", not the model's original claim.
      missing: trueGaps,
      matched: result.matchingSkills,
      note:
        candidateKeys.size > 0
          ? "The posting named no recognisable skill requirements."
          : "No skills were found on the CV to compare.",
    };
  }

  // A "required" gap costs more than a "nice to have" one.
  const weightedGapCost = trueGaps.reduce((sum, gap) => {
    if (gap.importance === "required") return sum + 1.5;
    if (gap.importance === "preferred") return sum + 1;
    return sum + 0.5;
  }, 0);

  const coverage = matched.length / (matched.length + weightedGapCost);
  const score = clamp(coverage * 100);

  const notes = [];
  if (verifiedMatches.length < matched.length) {
    notes.push(
      `${matched.length - verifiedMatches.length} listed match(es) were not found in the extracted skills section — check the evidence text.`,
    );
  }
  if (falseGaps.length > 0) {
    notes.push(
      `${falseGaps.length} reported gap(s) (${falseGaps.map((g) => g.name).join(", ")}) do appear in the CV skills and were not penalised.`,
    );
  }

  return {
    score,
    missing: trueGaps,
    matched: result.matchingSkills,
    note: notes.join(" ") || `${matched.length} of ${total} requirements evidenced.`,
  };
}

function scoreExperienceCategory({ result, analysis }) {
  const match = result.matchingExperience ?? {};
  const required = Number(match.requiredYears) || 0;
  const candidate = totalExperienceYears(analysis?.experience ?? []);

  // Trust the candidate's own CV over the model's estimate.
  const candidateYears = Math.max(candidate, Number(match.candidateYears) || 0);

  if (required <= 0) {
    return { score: 70, note: "The posting does not state a years-of-experience requirement." };
  }

  const ratio = candidateYears / required;
  const score = clamp(ratio >= 1 ? 100 : ratio * 100);

  const status = candidateYears >= required ? "meets" : candidateYears >= required * 0.7 ? "close" : "below";

  return {
    score,
    candidateYears,
    requiredYears: required,
    status,
    note:
      status === "meets"
        ? `${candidateYears} years of relevant experience against ${required} required.`
        : `${candidateYears} years of relevant experience against ${required} required.`,
  };
}

function scoreEducationCategory({ result, analysis }) {
  const match = result.matchingEducation ?? {};
  const status = match.status ?? "unknown";

  const scores = { compatible: 100, partial: 65, below: 25, unknown: 50 };

  const hasEducation = (analysis?.education ?? []).length > 0;
  const score = status === "unknown" && !hasEducation ? 20 : (scores[status] ?? 50);

  return {
    score,
    note:
      match.note ||
      (hasEducation
        ? "The CV lists education; the posting's requirement could not be read clearly."
        : "No education was found on the CV."),
  };
}

function scoreProjectsCategory({ result }) {
  const matching = result.matchingProjects ?? [];
  const missing = result.missingProjects ?? [];

  if (matching.length === 0 && missing.length === 0) {
    return { score: 50, note: "The posting does not ask for project evidence." };
  }

  const score = clamp(
    (matching.length / (matching.length + missing.length)) * 100,
  );

  return {
    score,
    note:
      matching.length > 0
        ? `${matching.length} project${matching.length === 1 ? "" : "s"} align with the role.`
        : "No project on the CV maps to this role.",
  };
}

function scoreKeywordsCategory({ result }) {
  const matching = result.matchingKeywords ?? [];
  const missing = result.missingKeywords ?? [];
  const total = matching.length + missing.length;

  if (total === 0) {
    return { score: 50, note: "No additional keywords were extracted from the posting." };
  }

  return {
    score: clamp((matching.length / total) * 100),
    note: `${matching.length} of ${total} posting keywords appear in the CV.`,
  };
}

function scoreCertificationsCategory({ result }) {
  const matching = result.matchingCertifications ?? [];
  const missing = result.missingCertifications ?? [];
  const total = matching.length + missing.length;

  if (total === 0) {
    // Certifications are only 5% and most postings ask for none: neutral, not zero.
    return { score: 60, note: "The posting lists no certification requirements." };
  }

  return {
    score: clamp((matching.length / total) * 100),
    note: `${matching.length} of ${total} requested certifications are on the CV.`,
  };
}

/** Builds the plain-language "why" lines shown under the score. */
function explainMatch({ result, analysis, categoryNotes }) {
  const strengths = [...(result.strengths ?? [])];

  if (strengths.length === 0) {
    for (const row of (result.matchingSkills ?? []).slice(0, 4)) {
      strengths.push(`+ ${row.evidence || `${row.name} appears in your CV`}`);
    }
  }

  const gaps = [...(result.gaps ?? [])];

  if (gaps.length === 0) {
    for (const gap of (result.missingSkills ?? []).slice(0, 4)) {
      gaps.push(`- No evidence of ${gap.name}${gap.hint ? ` — ${gap.hint}` : ""}`);
    }
  }

  const recommendations = [...(result.recommendations ?? [])];

  if (recommendations.length === 0) {
    // Fall back to whichever category cost the most points.
    const worst = [...categoryNotes].sort((a, b) => a.earned - b.earned)[0];

    if (worst) {
      recommendations.push(
        `Invest in ${worst.label.toLowerCase()}: it is the largest single gap in this score.`,
      );
    }
  }

  if ((analysis?.skills?.length ?? 0) === 0) {
    recommendations.push("Add a dedicated skills section — the match is scoring you blind without it.");
  }

  return { strengths, gaps, recommendations };
}

/**
 * Turns the AI's structured comparison into a scored, explainable result.
 *
 * @param {object} params
 * @param {object} params.result    normalised output of `matchJobToDescription`
 * @param {object} params.analysis  the candidate's stored analysis
 */
export function scoreJobMatch({ result, analysis }) {
  const categories = {
    skills: scoreSkillsCategory({ result, analysis }),
    experience: scoreExperienceCategory({ result, analysis }),
    education: scoreEducationCategory({ result, analysis }),
    projects: scoreProjectsCategory({ result }),
    keywords: scoreKeywordsCategory({ result }),
    certifications: scoreCertificationsCategory({ result }),
  };

  const breakdown = [];
  let total = 0;

  for (const { key, label, weight } of Object.values(MATCH_WEIGHTS)) {
    const category = categories[key];
    const earned = (category.score * weight) / 100;

    total += earned;

    breakdown.push({
      key,
      label,
      weight,
      score: category.score,
      earned: Math.round(earned * 10) / 10,
      note: category.note ?? "",
    });
  }

  const score = clamp(total);

  // Rewrite the experience row so the published numbers are the ones we scored.
  const experience = categories.experience;
  const experienceRow = {
    requiredYears: experience.requiredYears ?? result.matchingExperience?.requiredYears ?? 0,
    candidateYears: experience.candidateYears ?? result.matchingExperience?.candidateYears ?? 0,
    status: experience.status ?? result.matchingExperience?.status ?? "close",
    note: experience.note ?? result.matchingExperience?.note ?? "",
  };

  return {
    score,
    breakdown,
    matchingSkills: categories.skills.matched ?? result.matchingSkills ?? [],
    missingSkills: categories.skills.missing ?? result.missingSkills ?? [],
    matchingExperience: experienceRow,
    explain: explainMatch({ result, analysis, categoryNotes: breakdown }),
  };
}

/** Label shown next to the match percentage. */
export function matchVerdict(score) {
  if (score >= 85) return "Strong fit";
  if (score >= 70) return "Good match";
  if (score >= 55) return "Stretch role";
  return "Reach";
}

/**
 * Flattens a stored analysis into the rows the "My job matches" table needs,
 * without shipping the whole document.
 */
export function summariseMatch(job) {
  return {
    id: job._id.toString(),
    jobTitle: job.jobTitle,
    company: job.company,
    score: job.score,
    verdict: job.verdict,
    resume: job.resume?.toString?.() ?? job.resume,
    createdAt: job.createdAt,
    matchingSkills: (job.matchingSkills ?? []).map((row) => row.name),
    missingSkills: (job.missingSkills ?? []).map((row) => row.name),
  };
}

export default scoreJobMatch;
