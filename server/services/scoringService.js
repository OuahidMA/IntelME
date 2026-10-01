import { isPresent, parseResumeDate, totalExperienceYears } from "../utils/dates.js";

/**
 * The transparent CV score.
 *
 * Every point in the final number is produced here from data we can point at —
 * a missing phone number, a bullet with no metric in it — rather than being
 * guessed by the model. That is what lets the dashboard show
 * "Skills 20% → 17/20 earned" instead of a single opaque number.
 *
 * Weights are fixed by the product spec and sum to exactly 100.
 */

export const CV_WEIGHTS = {
  contact: { key: "contact", label: "Contact Information", weight: 10 },
  summary: { key: "summary", label: "Professional Summary", weight: 10 },
  skills: { key: "skills", label: "Skills", weight: 20 },
  experience: { key: "experience", label: "Experience", weight: 25 },
  education: { key: "education", label: "Education", weight: 10 },
  projects: { key: "projects", label: "Projects", weight: 10 },
  certifications: { key: "certifications", label: "Certifications", weight: 5 },
  structure: { key: "structure", label: "CV Structure", weight: 10 },
};

const clamp = (value) => Math.min(100, Math.max(0, Math.round(value)));

/** Linear ramp: 0 points at `from`, full points at `to`. */
function ramp(value, from, to) {
  if (to === from) return value >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

function hasNumber(text) {
  return /\d/.test(String(text ?? ""));
}

/** Detects a section heading in raw CV text, e.g. "WORK EXPERIENCE" or "Education". */
function hasSection(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

const SECTION_PATTERNS = {
  summary: /\b(professional\s+summary|summary|profile|objective|about\s+me)\b/i,
  experience: /\b(work\s+)?(experience|employment|professional\s+history|career\s+history)\b/i,
  skills: /\b(skills|technical\s+skills|technologies|tech\s+stack|competencies)\b/i,
  education: /\b(education|academic|qualifications)\b/i,
  projects: /\b(projects|personal\s+projects|portfolio|selected\s+work)\b/i,
  certifications: /\b(certifications?|licenses?|courses|training)\b/i,
};

/* ------------------------------------------------------------------ *
 * Category scorers — each returns 0-100 for its own category.
 * ------------------------------------------------------------------ */

function scoreContact({ profile }) {
  let earned = 0;
  const missing = [];

  if (profile?.fullName) earned += 30;
  else missing.push("No full name was found in your CV.");

  if (profile?.email) earned += 25;
  else missing.push("No email address was found in your CV.");

  if (profile?.phone) earned += 20;
  else missing.push("No phone number was found in your CV.");

  if (profile?.location) earned += 15;
  else missing.push("No location was found in your CV.");

  if (profile?.links?.length > 0) earned += 10;

  return {
    score: clamp(earned),
    note: missing.length > 0 ? missing.join(" ") : "All core contact fields are present.",
  };
}

function scoreSummary({ profile, skills }) {
  const summary = profile?.summary?.trim() ?? "";

  if (!summary) {
    return { score: 0, note: "No professional summary was found." };
  }

  let earned = 40; // having one at all is the baseline
  const notes = [`Summary is ${summary.length} characters long.`];

  if (summary.length >= 250 && summary.length <= 1200) {
    earned += 25;
    notes.push("Length is in the range recruiters scan.");
  } else {
    notes.push(
      summary.length < 250
        ? "Expand it — a short summary hides your strongest points."
        : "Trim it to roughly 1200 characters or fewer.",
    );
  }

  if (hasNumber(summary)) {
    earned += 20;
    notes.push("It contains at least one measurable number.");
  }

  const lowered = summary.toLowerCase();
  const namesSomeSkill = (skills ?? []).some((skill) =>
    lowered.includes(String(skill?.name ?? "").toLowerCase()),
  );

  if (namesSomeSkill) {
    earned += 15;
    notes.push("It names concrete technologies.");
  }

  return { score: clamp(earned), note: notes.join(" ") };
}

function scoreSkills({ skills }) {
  const list = skills ?? [];

  if (list.length === 0) {
    return { score: 0, note: "No skills were extracted." };
  }

  // Volume, saturating at 15 skills.
  let earned = ramp(list.length, 0, 15) * 40;

  // Breadth: a CV listing only frontend skills reads as narrow.
  const categories = new Set(list.map((skill) => skill?.category).filter(Boolean));
  earned += ramp(categories.size, 1, 5) * 30;

  // Depth: proportion rated Advanced or Expert.
  const senior = list.filter((skill) => /advanced|expert/i.test(skill?.level ?? "")).length;
  earned += ramp(senior / list.length, 0, 0.4) * 20;

  // Named, recognisable technologies rather than vague traits.
  const concrete = list.filter((skill) =>
    /[a-z0-9+#.]/i.test(skill?.name ?? "") && !/^(good|great|fast|hard-?working)$/i.test(skill?.name ?? ""),
  ).length;
  earned += ramp(concrete / list.length, 0, 0.8) * 10;

  return {
    score: clamp(earned),
    note: `${list.length} skills across ${categories.size} categor${categories.size === 1 ? "y" : "ies"}.`,
  };
}

function scoreExperience({ experience }) {
  const roles = experience ?? [];

  if (roles.length === 0) {
    return { score: 0, note: "No work experience was found." };
  }

  let earned = 20; // having any history at all

  const titled = roles.filter((role) => role?.title && role?.company).length;
  earned += ramp(titled / roles.length, 0, 1) * 15;

  const dated = roles.filter(
    (role) => parseResumeDate(role?.startDate) || parseResumeDate(role?.endDate) || isPresent(role?.endDate),
  ).length;
  earned += ramp(dated / roles.length, 0, 1) * 20;

  const described = roles.filter((role) => (role?.description?.trim().length ?? 0) > 20).length;
  earned += ramp(described / roles.length, 0, 1) * 20;

  // The single biggest lever: bullets that contain a number.
  const quantified = roles.filter((role) => hasNumber(role?.description)).length;
  const quantifiedShare = quantified / roles.length;
  earned += ramp(quantifiedShare, 0, 0.7) * 25;

  const years = totalExperienceYears(roles);
  const notes = [`${roles.length} role${roles.length === 1 ? "" : "s"}, roughly ${years} year${years === 1 ? "" : "s"} of experience.`];

  if (quantifiedShare < 0.5) {
    notes.push("Most entries describe duties without measurable results.");
  }

  return { score: clamp(earned), note: notes.join(" ") };
}

function scoreEducation({ education }) {
  const entries = education ?? [];

  if (entries.length === 0) {
    return { score: 0, note: "No education was found." };
  }

  let earned = 40; // at least one entry

  const withDegree = entries.filter((entry) => entry?.degree || entry?.field).length;
  earned += ramp(withDegree / entries.length, 0, 1) * 20;

  const withInstitution = entries.filter((entry) => entry?.institution).length;
  earned += ramp(withInstitution / entries.length, 0, 1) * 20;

  const withDates = entries.filter(
    (entry) => parseResumeDate(entry?.startDate) || parseResumeDate(entry?.endDate),
  ).length;
  earned += ramp(withDates / entries.length, 0, 1) * 20;

  return {
    score: clamp(earned),
    note: `${entries.length} education entr${entries.length === 1 ? "y" : "ies"} recorded.`,
  };
}

function scoreProjects({ projects }) {
  const entries = projects ?? [];

  if (entries.length === 0) {
    return { score: 0, note: "No projects were found." };
  }

  let earned = 35;

  const named = entries.filter((entry) => entry?.name).length;
  earned += ramp(named / entries.length, 0, 1) * 15;

  const described = entries.filter((entry) => (entry?.description?.trim().length ?? 0) > 20).length;
  earned += ramp(described / entries.length, 0, 1) * 20;

  const withTech = entries.filter((entry) => (entry?.technologies?.length ?? 0) > 0).length;
  earned += ramp(withTech / entries.length, 0, 1) * 20;

  const withLink = entries.filter((entry) => entry?.link).length;
  earned += ramp(withLink / entries.length, 0, 1) * 10;

  return {
    score: clamp(earned),
    note: `${entries.length} project${entries.length === 1 ? "" : "s"} described.`,
  };
}

function scoreCertifications({ certifications }) {
  const entries = certifications ?? [];

  if (entries.length === 0) {
    return { score: 0, note: "No certifications were found." };
  }

  let earned = 60;

  const withIssuer = entries.filter((entry) => entry?.issuer).length;
  earned += ramp(withIssuer / entries.length, 0, 1) * 20;

  const withDate = entries.filter((entry) => entry?.date).length;
  earned += ramp(withDate / entries.length, 0, 1) * 20;

  return {
    score: clamp(earned),
    note: `${entries.length} certification${entries.length === 1 ? "" : "s"} listed.`,
  };
}

function scoreStructure({ rawText }) {
  const text = String(rawText ?? "").trim();
  const notes = [];

  if (!text) {
    return { score: 0, note: "No text could be read from the file." };
  }

  let earned = 0;

  if (text.length >= 800) {
    earned += 20;
    notes.push("Enough content to read.");
  } else {
    notes.push("The file is very short — recruiters will find little to scan.");
  }

  if (hasSection(text, [SECTION_PATTERNS.experience])) {
    earned += 20;
    notes.push("Experience section found.");
  } else {
    notes.push("No experience heading was detected.");
  }

  if (hasSection(text, [SECTION_PATTERNS.skills])) {
    earned += 15;
    notes.push("Skills section found.");
  }

  if (hasSection(text, [SECTION_PATTERNS.education])) {
    earned += 15;
    notes.push("Education section found.");
  }

  // Contact details should be reachable without deep scrolling.
  const head = text.slice(0, 600);
  if (/@/.test(head) || /\+?\d[\d\s().-]{7,}/.test(head)) {
    earned += 15;
    notes.push("Contact details appear near the top.");
  } else {
    notes.push("Contact details are not visible in the first section.");
  }

  // A wall of text or an empty shell both hurt readability.
  const words = text.split(/\s+/).length;
  if (words >= 150 && words <= 1500) {
    earned += 15;
    notes.push(`${words} words, a readable length.`);
  }

  return { score: clamp(earned), note: notes.join(" ") };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * What to actually do about a weak category.
 *
 * The model is asked for recommendations as well, but it reasonably returns an
 * empty list for a strong CV — and an empty "Improvements" panel is not a useful
 * answer when the breakdown already shows exactly which category dropped the
 * points. These lines come from the score, so they appear whenever the score
 * justifies them.
 */
const CATEGORY_ADVICE = {
  contact:
    "Add a phone number, your location and a link to your portfolio or GitHub — recruiters filter on these before they read anything else.",
  summary:
    "Rewrite the summary as two or three specific sentences that name your role, your years of experience and one measurable result.",
  skills:
    "List more technologies and group them by area (frontend, backend, tooling) instead of leaving them as one flat run-on line.",
  experience:
    "Rewrite your bullet points so each one names the action and a number: what you did, and what changed as a result.",
  education:
    "Add the degree, the field, the institution and the years for every entry so a recruiter can match it against the role.",
  projects:
    "Give each project a one-line description and the technologies behind it, plus a link if you have one.",
  certifications:
    "Add the certifications relevant to the role, naming the issuing organisation and the year.",
  structure:
    "Use clear headings for experience, skills and education, and keep your contact details in the first screen of the document.",
};

/** A category at or above this score does not need a recommendation. */
const RECOMMENDATION_THRESHOLD = 90;

/**
 * Produces the overall score plus the per-category breakdown the UI renders.
 *
 * @param {object} params
 * @param {object} params.analysis  the AI-extracted, already-validated CV data
 * @param {string} params.rawText  the plain text the file was parsed into
 * @returns {{score: number, breakdown: Array, strengths: string[], weaknesses: string[], recommendations: string[]}}
 */
export function scoreResume({ analysis, rawText = "" }) {
  const context = { ...analysis, rawText };

  const scorers = {
    contact: scoreContact,
    summary: scoreSummary,
    skills: scoreSkills,
    experience: scoreExperience,
    education: scoreEducation,
    projects: scoreProjects,
    certifications: scoreCertifications,
    structure: scoreStructure,
  };

  const breakdown = [];
  let total = 0;

  for (const { key, label, weight } of Object.values(CV_WEIGHTS)) {
    const { score, note } = scorers[key](context);
    // earned is this category's contribution to the 100-point total.
    const earned = (score * weight) / 100;

    total += earned;

    breakdown.push({
      key,
      label,
      weight,
      score,
      earned: Math.round(earned * 10) / 10,
      note,
    });
  }

  const score = clamp(total);

  // The weakest categories become the prioritised fix list.
  const ranked = [...breakdown].sort((a, b) => a.score - b.score);
  const weaknesses = ranked
    .filter((row) => row.score < 70)
    .slice(0, 4)
    .map((row) => `${row.label} scored ${row.score}% (worth ${row.weight}% of the total). ${row.note}`);

  const strengths = ranked
    .filter((row) => row.score >= 80)
    .slice(0, 4)
    .map((row) => `${row.label} scored ${row.score}% — ${row.note}`);

  // Fixes are ordered by how much of the missing score they would recover, not
  // by raw score: a category worth 25% of the total is a better use of the
  // candidate's time than one worth 5%.
  const recoverable = breakdown
    .filter((row) => row.score < RECOMMENDATION_THRESHOLD && CATEGORY_ADVICE[row.key])
    .map((row) => ({
      row,
      upside: ((RECOMMENDATION_THRESHOLD - row.score) * row.weight) / 100,
    }))
    .sort((a, b) => b.upside - a.upside)
    .slice(0, 6);

  const recommendations = recoverable.map(
    ({ row }) => `${row.label} scored ${row.score}% (worth ${row.weight}% of your total). ${CATEGORY_ADVICE[row.key]}`
  );

  return { score, breakdown, strengths, weaknesses, recommendations };
}

/** One-line verdict used next to "82 / 100". */
export function scoreVerdict(score) {
  if (score >= 85) return "Excellent — this CV is close to ready to send.";
  if (score >= 70) return "Solid, with a few structural fixes worth making.";
  if (score >= 50) return "Usable, but real information is being left out.";
  return "Weak — the file is not yet communicating your experience.";
}

export default scoreResume;
