import Groq from "groq-sdk";

/**
 * Every call the app makes to Groq goes through here.
 *
 * The API key is read from the process environment and stays on the server. It
 * is never imported by, bundled into, or returned to the React client.
 *
 * Each call sends one of the two canonical prompts below, followed by a JSON
 * contract that pins the response to the shape our Mongoose models expect. The
 * prompt is the model's brief; the contract is what makes "return only valid
 * JSON" actually parseable instead of a best guess.
 */

/* ------------------------------------------------------------------ *
 * Prompt design — Resume analysis
 * ------------------------------------------------------------------ */
export const PROMPT_RESUME_ANALYSIS = `You are an expert resume analysis assistant.
Analyze the following resume.
Extract structured information about:
- candidate profile
- skills
- experience
- education
- certifications
- projects
- languages
Evaluate the resume structure and completeness.
Return ONLY valid JSON.
Resume:
{{RESUME_TEXT}}`;

/* ------------------------------------------------------------------ *
 * Prompt design — Job match
 * ------------------------------------------------------------------ */
export const PROMPT_JOB_MATCH = `You are an AI career matching assistant.
Compare the candidate profile against the job description.
Analyze: technical skills, soft skills,
experience, education, projects, certifications, keywords.
Return structured JSON containing:
- overallScore
- matchingSkills
- missingSkills
- matchingExperience
- missingExperience
- matchingEducation
- recommendations`;

/* ------------------------------------------------------------------ *
 * Prompt design — Improve my CV
 * ------------------------------------------------------------------ */
export const PROMPT_IMPROVE_CV = `You are an expert resume writer and career coach.
You are given a candidate's current resume summary and CV weaknesses.
Rewrite the professional summary so it is specific, quantified and free of
cliches, and suggest concrete wording improvements.
Never invent employers, dates, employers or achievements that are not present in
the source. Every suggestion must be a recommendation for the candidate to
review, not a claim of fact.
Return ONLY valid JSON.`;

/** Response contract appended to the resume prompt. */
const RESUME_JSON_CONTRACT = `
Respond with a single JSON object, no markdown fences, no commentary, using exactly this shape:
{
  "profile": { "fullName": string, "email": string, "phone": string, "location": string, "summary": string, "links": string[] },
  "skills": [{ "name": string, "category": string, "level": string }],
  "experience": [{ "title": string, "company": string, "location": string, "startDate": string, "endDate": string, "current": boolean, "description": string }],
  "education": [{ "degree": string, "field": string, "institution": string, "startDate": string, "endDate": string, "grade": string }],
  "certifications": [{ "name": string, "issuer": string, "date": string }],
  "languages": [{ "name": string, "proficiency": string }],
  "projects": [{ "name": string, "description": string, "technologies": string[], "link": string }],
  "keywords": string[],
  "strengths": string[],
  "weaknesses": string[],
  "recommendations": string[]
}
Rules:
- "category" for a skill is one of: Frontend, Backend, Database, DevOps, Mobile, Data, Design, Testing, Cloud, Tools, Soft Skill, Other.
- "level" for a skill is one of: Beginner, Intermediate, Advanced, Expert.
- Use empty arrays and empty strings for anything the resume does not state. Never guess or invent.
- Dates use "YYYY-MM" or "YYYY". Use an empty endDate and "current": true for a present role.
- strengths, weaknesses and recommendations are short plain-English sentences.`;

/** Response contract appended to the job-match prompt. */
const JOB_MATCH_JSON_CONTRACT = `
Candidate profile:
{{CANDIDATE_PROFILE}}

Job description:
{{JOB_DESCRIPTION}}

Respond with a single JSON object, no markdown fences, no commentary, using exactly this shape:
{
  "jobTitle": string,
  "company": string,
  "verdict": string,
  "summary": string,
  "overallScore": number,
  "matchingSkills": [{ "name": string, "evidence": string }],
  "missingSkills": [{ "name": string, "importance": "required" | "preferred" | "nice-to-have", "hint": string }],
  "matchingExperience": { "requiredYears": number, "candidateYears": number, "status": "meets" | "close" | "below", "note": string },
  "missingExperience": string[],
  "matchingEducation": { "required": string, "candidate": string, "status": "compatible" | "partial" | "below" | "unknown", "note": string },
  "matchingProjects": string[],
  "missingProjects": string[],
  "matchingKeywords": string[],
  "missingKeywords": string[],
  "matchingCertifications": string[],
  "missingCertifications": string[],
  "strengths": string[],
  "gaps": string[],
  "recommendations": string[]
}
Rules:
- "overallScore" is an integer from 0 to 100.
- "strengths" and "gaps" are single lines each, phrased for the candidate: strengths may start with "+", gaps must start with "-".
- Only list a skill as matching if the profile actually shows it. Do not invent evidence.
- "candidateYears" is total relevant professional experience in years.`;

/** Response contract for the "Improve my CV" endpoint. */
const IMPROVE_JSON_CONTRACT = `
Current summary:
{{CURRENT_SUMMARY}}

Weaknesses to fix:
{{WEAKNESSES}}

Respond with a single JSON object, no markdown fences, using exactly this shape:
{
  "improvedSummary": string,
  "suggestions": string[],
  "rewrittenBullets": string[],
  "disclaimer": string
}
Rules:
- "improvedSummary" is 2-3 sentences, specific and free of cliches such as "passionate" or "hard-working".
- "disclaimer" must state that these are AI-generated suggestions for the candidate to review.`;

const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

/** Keeps prompts inside the context window without losing the top of the CV. */
const MAX_RESUME_CHARS = 14_000;
const MAX_JOB_CHARS = 12_000;
const MAX_PROFILE_CHARS = 6_000;
const MAX_OUT_CHARS = 200_000;

export class AIServiceError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message);
    this.name = "AIServiceError";
    this.status = status;
    this.cause = cause;
  }
}

let client;

function getClient() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new AIServiceError(
      "AI analysis is not configured on the server. Add GROQ_API_KEY to server/.env.",
      { status: 503 },
    );
  }

  if (!client) {
    client = new Groq({ apiKey });
  }

  return client;
}

export function isAIConfigured() {
  return Boolean(process.env.GROQ_API_KEY);
}

function clip(text, max) {
  const value = typeof text === "string" ? text : "";

  return value.length > max ? `${value.slice(0, max)}\n[…truncated…]` : value;
}

function fill(template, replacements) {
  return Object.entries(replacements).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    template,
  );
}

/** Models often wrap JSON in ```json fences or add a sentence around it. */
export function extractJson(raw) {
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  // Slice from the first brace to the last one, ignoring any prose around it.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Sends the canonical prompt followed by the response contract.
 *
 * The substitution runs over the *combined* message, not just the prompt: the
 * two prompts the product defines carry no `{{...}}` slots of their own, the
 * data slots live in the contract, and filling only the prompt would leave the
 * model reading the literal text "{{JOB_DESCRIPTION}}".
 */
/** Attempts per model call before giving up on a document. */
const MAX_ATTEMPTS = 3;

/** Base backoff between attempts; grows linearly with the attempt number. */
const RETRY_DELAY_MS = 750;

async function requestJson({ prompt, contract = "", replacements = {}, temperature = 0.2, label }) {  const groq = getClient();

  const content = fill([prompt, contract].filter(Boolean).join("\n"), replacements);
  const messages = [{ role: "user", content }];

  let lastError;

  // Even with JSON mode the model occasionally returns prose or truncated JSON.
  // Retrying is the only remedy, and it works often enough to be worth the wait:
  // the second attempt drops the temperature to 0, which makes the same prompt
  // far more likely to produce the same shape.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const completion = await groq.chat.completions.create({
        model: MODEL,
        messages,
        temperature: attempt === 0 ? temperature : 0,
        max_completion_tokens: 4096,
        // Groq supports OpenAI-compatible structured output; this is what makes
        // "return ONLY valid JSON" reliable.
        response_format: { type: "json_object" },
      });

      const content = completion?.choices?.[0]?.message?.content ?? "";
      const parsed = extractJson(content);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }

      lastError = new Error("model did not return a JSON object");
    } catch (error) {
      lastError = error;

      // A bad key or a rate limit will not fix itself on retry.
      if (error?.status === 401 || error?.status === 429) break;
    }

    // Back off before the next attempt, but not after the last one.
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
    }
  }

  console.error(`[ai] ${label} failed:`, lastError?.message);

  // A rate limit is not a malformed document, and telling someone to "try again"
  // when their provider quota is spent sends them round in circles. Say what is
  // actually wrong.
  if (lastError?.status === 429) {
    throw new AIServiceError(
      "The AI service is rate limited right now. Wait a minute and try again.",
      { cause: lastError },
    );
  }

  throw new AIServiceError(
    "The AI could not produce a structured result for this document. Please try again.",
    { cause: lastError },
  );
}

/* ------------------------------------------------------------------ *
 * Normalisers — the model is helpful but not trusted with types.
 * ------------------------------------------------------------------ */

const asText = (value, max = 400) =>
  (typeof value === "string" ? value : value == null ? "" : String(value))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const asBool = (value) => value === true || value === "true";

function asList(value, { max = 60, maxLength = 300 } = {}) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n|;|,(?![^(]*\))/)
      : [];

  return source
    .map((item) =>
      typeof item === "string" ? item : item && typeof item === "object" ? (item.name ?? item.title ?? "") : "",
    )
    .map((item) => asText(item, maxLength))
    .filter(Boolean)
    .slice(0, max);
}

function asNumber(value, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const SKILL_CATEGORIES = new Set([
  "Frontend",
  "Backend",
  "Database",
  "DevOps",
  "Mobile",
  "Data",
  "Design",
  "Testing",
  "Cloud",
  "Tools",
  "Soft Skill",
  "Other",
]);

const SKILL_LEVELS = new Set(["Beginner", "Intermediate", "Advanced", "Expert"]);

/**
 * The model returns the right *shape* but frequently leaves `category` and
 * `level` as empty strings, so a taxonomy it ignored cannot be recovered by
 * asking it again. These tables classify a skill from its own name instead,
 * which is deterministic, testable, and better than collapsing every skill into
 * "Other". Keys are matched as substrings of the lowercased skill name.
 */
const SKILL_CATEGORY_HINTS = [
  ["react", "Frontend"],
  ["next", "Frontend"],
  ["vue", "Frontend"],
  ["angular", "Frontend"],
  ["svelte", "Frontend"],
  ["typescript", "Frontend"],
  ["javascript", "Frontend"],
  ["html", "Frontend"],
  ["css", "Frontend"],
  ["sass", "Frontend"],
  ["tailwind", "Frontend"],
  ["redux", "Frontend"],
  ["flutter", "Mobile"],
  ["react native", "Mobile"],
  ["swift", "Mobile"],
  ["kotlin", "Mobile"],
  ["android", "Mobile"],
  ["ios", "Mobile"],
  ["node", "Backend"],
  ["express", "Backend"],
  ["nest", "Backend"],
  ["django", "Backend"],
  ["flask", "Backend"],
  ["spring", "Backend"],
  ["java", "Backend"],
  ["c#", "Backend"],
  ["dotnet", "Backend"],
  ["php", "Backend"],
  ["laravel", "Backend"],
  ["rest", "Backend"],
  ["graphql", "Backend"],
  ["api", "Backend"],
  ["mongo", "Database"],
  ["postgres", "Database"],
  ["mysql", "Database"],
  ["sqlite", "Database"],
  ["redis", "Database"],
  ["sql", "Database"],
  ["oracle", "Database"],
  ["dynamodb", "Database"],
  ["docker", "DevOps"],
  ["kubernetes", "DevOps"],
  ["terraform", "DevOps"],
  ["ansible", "DevOps"],
  ["jenkins", "DevOps"],
  ["ci/cd", "DevOps"],
  ["linux", "DevOps"],
  ["nginx", "DevOps"],
  ["aws", "Cloud"],
  ["azure", "Cloud"],
  ["gcp", "Cloud"],
  ["cloud", "Cloud"],
  ["serverless", "Cloud"],
  ["python", "Data"],
  ["pandas", "Data"],
  ["numpy", "Data"],
  ["machine learning", "Data"],
  ["deep learning", "Data"],
  ["tensorflow", "Data"],
  ["pytorch", "Data"],
  ["data science", "Data"],
  ["etl", "Data"],
  ["power bi", "Data"],
  ["tableau", "Data"],
  ["figma", "Design"],
  ["sketch", "Design"],
  ["adobe", "Design"],
  ["photoshop", "Design"],
  ["illustrator", "Design"],
  ["ux", "Design"],
  ["ui", "Design"],
  ["wireframe", "Design"],
  ["jest", "Testing"],
  ["mocha", "Testing"],
  ["cypress", "Testing"],
  ["playwright", "Testing"],
  ["selenium", "Testing"],
  ["unit test", "Testing"],
  ["testing", "Testing"],
  ["git", "Tools"],
  ["github", "Tools"],
  ["gitlab", "Tools"],
  ["jira", "Tools"],
  ["webpack", "Tools"],
  ["vite", "Tools"],
  ["npm", "Tools"],
  ["linux", "Tools"],
  ["communication", "Soft Skill"],
  ["leadership", "Soft Skill"],
  ["teamwork", "Soft Skill"],
  ["problem solving", "Soft Skill"],
];

/** Seniority words that imply a level when the model omits one. */
const SKILL_LEVEL_HINTS = [
  ["architect", "Expert"],
  ["lead", "Advanced"],
  ["expert", "Expert"],
  ["mastery", "Expert"],
  ["advanced", "Advanced"],
  ["senior", "Advanced"],
  ["principal", "Expert"],
  ["intermediate", "Intermediate"],
  ["beginner", "Beginner"],
  ["basic", "Beginner"],
  ["junior", "Beginner"],
  ["intern", "Beginner"],
];

function inferFromHints(name, hints) {
  const haystack = String(name ?? "").toLowerCase();

  for (const [needle, value] of hints) {
    if (haystack.includes(needle)) return value;
  }

  return null;
}

function inferCategory(name) {
  return inferFromHints(name, SKILL_CATEGORY_HINTS) ?? "Other";
}

function inferLevel(name) {
  return inferFromHints(name, SKILL_LEVEL_HINTS) ?? "Intermediate";
}

function pickEnum(value, allowed, fallback) {
  const cleaned = asText(value, 40);
  // `allowed` may be a Set, so it is compared case-insensitively by iteration
  // rather than by index.
  for (const entry of allowed) {
    if (entry.toLowerCase() === cleaned.toLowerCase()) return entry;
  }

  return fallback;
}

function normaliseSkills(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((skill) => skill && typeof skill === "object" && asText(skill.name, 80))
    .slice(0, 80)
    .map((skill) => ({
      name: asText(skill.name, 80),
      // The model's own value wins when it is one of the allowed values;
      // otherwise the category is derived from the skill's name.
      category: pickEnum(skill.category, SKILL_CATEGORIES, inferCategory(skill.name)),
      level: pickEnum(skill.level, SKILL_LEVELS, inferLevel(skill.name)),
    }));
}

function normaliseExperience(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item === "object")
    .slice(0, 30)
    .map((item) => ({
      title: asText(item.title ?? item.role ?? item.position, 120),
      company: asText(item.company ?? item.employer, 120),
      location: asText(item.location, 120),
      startDate: asText(item.startDate ?? item.start, 20),
      endDate: asText(item.endDate ?? item.end, 20),
      current: asBool(item.current) || /present|current|now/i.test(asText(item.endDate ?? item.end, 20)),
      durationMonths: Math.max(0, Math.round(asNumber(item.durationMonths, 0))),
      description: asText(item.description ?? item.highlights, 1200),
    }))
    .filter((item) => item.title || item.company);
}

function normaliseEducation(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item === "object")
    .slice(0, 15)
    .map((item) => ({
      degree: asText(item.degree ?? item.studyType, 120),
      field: asText(item.field ?? item.area, 120),
      institution: asText(item.institution ?? item.school ?? item.university, 160),
      startDate: asText(item.startDate ?? item.start, 20),
      endDate: asText(item.endDate ?? item.end, 20),
      grade: asText(item.grade, 40),
    }))
    .filter((item) => item.degree || item.institution || item.field);
}

function normaliseCertifications(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item === "object")
    .slice(0, 30)
    .map((item) => ({
      name: asText(item.name, 160),
      issuer: asText(item.issuer ?? item.organization, 120),
      date: asText(item.date ?? item.year, 20),
    }))
    .filter((item) => item.name);
}

function normaliseLanguages(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item === "object")
    .slice(0, 15)
    .map((item) => ({
      name: asText(item.name ?? item.language, 60),
      proficiency: asText(item.proficiency ?? item.level, 40),
    }))
    .filter((item) => item.name);
}

function normaliseProjects(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item === "object")
    .slice(0, 30)
    .map((item) => ({
      name: asText(item.name ?? item.title, 160),
      description: asText(item.description, 1200),
      technologies: asList(item.technologies ?? item.stack ?? item.tech, { max: 25, maxLength: 80 }),
      link: asText(item.link ?? item.url, 300),
    }))
    .filter((item) => item.name || item.description);
}

function normaliseProfile(value) {
  const profile = value && typeof value === "object" ? value : {};

  return {
    fullName: asText(profile.fullName ?? profile.name, 120),
    email: asText(profile.email, 160).toLowerCase(),
    phone: asText(profile.phone, 40),
    location: asText(profile.location, 160),
    summary: asText(profile.summary ?? profile.objective, 2000),
    links: asList(profile.links ?? profile.urls, { max: 10, maxLength: 300 }),
  };
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Prompt design — Resume analysis.
 * Sends `PROMPT_RESUME_ANALYSIS` with the extracted text, returns validated data.
 */
export async function analyseResume(extractedText) {
  const raw = await requestJson({
    prompt: PROMPT_RESUME_ANALYSIS,
    contract: RESUME_JSON_CONTRACT,
    replacements: { RESUME_TEXT: clip(extractedText, MAX_RESUME_CHARS) },
    label: "resume analysis",
  });

  const structured = {
    profile: normaliseProfile(raw.profile),
    skills: normaliseSkills(raw.skills),
    experience: normaliseExperience(raw.experience),
    education: normaliseEducation(raw.education),
    certifications: normaliseCertifications(raw.certifications),
    languages: normaliseLanguages(raw.languages),
    projects: normaliseProjects(raw.projects),
    keywords: asList(raw.keywords, { max: 60, maxLength: 60 }),
    strengths: asList(raw.strengths, { max: 10, maxLength: 300 }),
    weaknesses: asList(raw.weaknesses, { max: 10, maxLength: 300 }),
    recommendations: asList(raw.recommendations, { max: 12, maxLength: 400 }),
  };

  // Keywords drive the "Keywords" row of the job-match score. When the model
  // returns none, they are rebuilt from the structured data we do have, which is
  // exactly the vocabulary a posting is likely to be matched against.
  if (structured.keywords.length === 0) {
    structured.keywords = deriveKeywords(structured);
  }

  return structured;
}

/** Reconstructs a keyword list from skills and project technologies. */
function deriveKeywords(structured) {
  const collected = [];

  for (const skill of structured.skills) collected.push(skill.name);
  for (const project of structured.projects) collected.push(...project.technologies);
  for (const language of structured.languages) collected.push(language.name);

  return [...new Set(collected.map((entry) => asText(entry, 60)).filter(Boolean))].slice(0, 60);
}

/** Compact profile of a stored analysis, used as the candidate side of a match. */
export function toMatchProfile(analysis) {
  return {
    profile: analysis.profile,
    skills: analysis.skills,
    experience: analysis.experience,
    education: analysis.education,
    certifications: analysis.certifications,
    languages: analysis.languages,
    projects: analysis.projects,
    keywords: analysis.keywords,
    score: analysis.score,
  };
}

const IMPORTANCE_VALUES = new Set(["required", "preferred", "nice-to-have"]);

/**
 * Prompt design — Job match.
 * Sends `PROMPT_JOB_MATCH` with the candidate profile and the pasted posting.
 */
export async function matchJobToDescription({ profile, jobDescription }) {
  const raw = await requestJson({
    prompt: PROMPT_JOB_MATCH,
    contract: JOB_MATCH_JSON_CONTRACT,
    replacements: {
      CANDIDATE_PROFILE: clip(JSON.stringify(profile, null, 2), MAX_PROFILE_CHARS),
      JOB_DESCRIPTION: clip(jobDescription, MAX_JOB_CHARS),
    },
    temperature: 0.1,
    label: "job match",
  });

  const covered = (value) =>
    (Array.isArray(value) ? value : [])
      .filter((item) => item && typeof item === "object" && asText(item.name, 80))
      .slice(0, 60)
      .map((item) => ({ name: asText(item.name, 80), evidence: asText(item.evidence, 400) }));

  const gaps = (value) =>
    (Array.isArray(value) ? value : [])
      .filter((item) => item && typeof item === "object" && asText(item.name, 80))
      .slice(0, 60)
      .map((item) => ({
        name: asText(item.name, 80),
        importance: IMPORTANCE_VALUES.has(item.importance) ? item.importance : "required",
        hint: asText(item.hint, 400),
      }));

  const experience = raw.matchingExperience ?? {};
  const education = raw.matchingEducation ?? {};

  return {
    jobTitle: asText(raw.jobTitle, 120),
    company: asText(raw.company, 120),
    verdict: asText(raw.verdict, 80),
    summary: asText(raw.summary, 1200),

    // Clamped here; the weighted total is recomputed in matchingService so the
    // published score always matches the published breakdown.
    overallScore: Math.min(100, Math.max(0, Math.round(asNumber(raw.overallScore, 0)))),

    matchingSkills: covered(raw.matchingSkills),
    missingSkills: gaps(raw.missingSkills),
    matchingExperience: {
      requiredYears: Math.max(0, asNumber(experience.requiredYears, 0)),
      candidateYears: Math.max(0, asNumber(experience.candidateYears, 0)),
      status: ["meets", "close", "below"].includes(experience.status) ? experience.status : "close",
      note: asText(experience.note, 600),
    },
    missingExperience: asList(raw.missingExperience, { max: 15, maxLength: 300 }),
    matchingEducation: {
      required: asText(education.required, 300),
      candidate: asText(education.candidate, 300),
      status: ["compatible", "partial", "below", "unknown"].includes(education.status)
        ? education.status
        : "unknown",
      note: asText(education.note, 600),
    },
    matchingProjects: asList(raw.matchingProjects, { max: 20, maxLength: 200 }),
    missingProjects: asList(raw.missingProjects, { max: 20, maxLength: 200 }),
    matchingKeywords: asList(raw.matchingKeywords, { max: 40, maxLength: 60 }),
    missingKeywords: asList(raw.missingKeywords, { max: 40, maxLength: 60 }),
    matchingCertifications: asList(raw.matchingCertifications, { max: 20, maxLength: 160 }),
    missingCertifications: asList(raw.missingCertifications, { max: 20, maxLength: 160 }),

    strengths: asList(raw.strengths, { max: 12, maxLength: 300 }),
    gaps: asList(raw.gaps, { max: 12, maxLength: 300 }),
    recommendations: asList(raw.recommendations, { max: 12, maxLength: 400 }),
  };
}

/**
 * "Improve my CV": rewrites the summary and proposes sharper wording.
 * Always returned with a disclaimer that these are suggestions to review.
 */
export async function improveCv({ profile, weaknesses, recommendations }) {
  const raw = await requestJson({
    prompt: PROMPT_IMPROVE_CV,
    contract: IMPROVE_JSON_CONTRACT,
    replacements: {
      CURRENT_SUMMARY: clip(profile?.summary ?? "", 2000) || "(no summary found)",
      WEAKNESSES: clip(
        [...(weaknesses ?? []), ...(recommendations ?? [])].join("\n- ") || "(none supplied)",
        2000,
      ),
    },
    label: "improve cv",
  });

  return {
    improvedSummary: asText(raw.improvedSummary, 2000),
    suggestions: asList(raw.suggestions, { max: 12, maxLength: 400 }),
    rewrittenBullets: asList(raw.rewrittenBullets, { max: 12, maxLength: 400 }),
    disclaimer:
      asText(raw.disclaimer, 400) ||
      "These are AI-generated suggestions, not verified facts. Review every line against your own experience before using it.",
  };
}

export { MODEL, MAX_OUT_CHARS, clip, fill, RESUME_JSON_CONTRACT, JOB_MATCH_JSON_CONTRACT };
export default {
  analyseResume,
  matchJobToDescription,
  improveCv,
  toMatchProfile,
  isAIConfigured,
};
