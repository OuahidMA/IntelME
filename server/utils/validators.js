/**
 * Input validation. Every controller runs its payload through one of these
 * helpers before doing any work, so bad input fails fast with a 400 and a
 * field-level message.
 *
 * Two families live here:
 *
 *  - Account input (register, login, profile, password). Small and strict.
 *  - Browser-supplied document data (a CV's text, an analysis to re-score, the
 *    versions to compare). This is new: the browser holds the analysis and sends
 *    it back for scoring, so these sanitisers are the boundary that keeps a
 *    hand-crafted payload from reaching the model or the arithmetic. They coerce
 *    types and cap sizes rather than rejecting, because a stored analysis is our
 *    own output from an earlier call and must survive the round trip.
 */

export const MAX_PASSWORD_LENGTH = 72; // bcrypt hashes at most 72 bytes

/** Error carrying an HTTP status, picked up by the error middleware. */
export class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
    this.details = details;
  }
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normaliseEmail(value) {
  return asString(value).toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Collapses runs of whitespace so a paste with blank lines still reads well. */
export function collapseWhitespace(value) {
  return asString(value).replace(/\s+/g, " ");
}

export function validateRegister({ name, email, password } = {}) {
  const errors = {};
  const cleanName = asString(name);
  const cleanEmail = normaliseEmail(email);
  const cleanPassword = typeof password === "string" ? password : "";

  if (cleanName.length < 2) errors.name = "Name must be at least 2 characters.";
  if (cleanName.length > 80) errors.name = "Name must be 80 characters or fewer.";
  if (!isValidEmail(cleanEmail)) errors.email = "Enter a valid email address.";
  if (cleanPassword.length < 8) errors.password = "Password must be at least 8 characters.";
  if (cleanPassword.length > MAX_PASSWORD_LENGTH) {
    errors.password = `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Please fix the highlighted fields.", errors);
  }

  // The name is stored, never trimmed of meaningful inner spaces.
  return { name: cleanName, email: cleanEmail, password: cleanPassword };
}

export function validateLogin({ email, password } = {}) {
  const cleanEmail = normaliseEmail(email);
  const cleanPassword = typeof password === "string" ? password : "";

  // Deliberately vague: we do not reveal whether the email exists.
  if (!isValidEmail(cleanEmail) || cleanPassword.length === 0) {
    throw new ValidationError("Email and password are required.");
  }

  return { email: cleanEmail, password: cleanPassword };
}

export function validateProfileUpdate(payload = {}) {
  const update = {};
  const errors = {};

  if (payload.name !== undefined) {
    const cleanName = asString(payload.name);
    if (cleanName.length < 2 || cleanName.length > 80) {
      errors.name = "Name must be between 2 and 80 characters.";
    } else {
      update.name = cleanName;
    }
  }

  if (payload.email !== undefined) {
    const cleanEmail = normaliseEmail(payload.email);
    if (!isValidEmail(cleanEmail)) {
      errors.email = "Enter a valid email address.";
    } else {
      update.email = cleanEmail;
    }
  }

  // Email and password changes are intentionally not supported here: both need
  // the current password to be supplied first, which would be a separate flow.
  if (payload.password !== undefined) {
    errors.password = "Password changes are not available from this endpoint.";
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Please fix the highlighted fields.", errors);
  }

  if (Object.keys(update).length === 0) {
    throw new ValidationError("Nothing to update.");
  }

  return update;
}

export function validatePasswordChange({ currentPassword, newPassword } = {}) {
  const errors = {};

  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    errors.currentPassword = "Current password is required.";
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    errors.newPassword = "New password must be at least 8 characters.";
  }
  if (typeof newPassword === "string" && newPassword.length > MAX_PASSWORD_LENGTH) {
    errors.newPassword = `New password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Please fix the highlighted fields.", errors);
  }

  return { currentPassword, newPassword };
}

/* ------------------------------------------------------------------ *
 * Browser-supplied document data
 * ------------------------------------------------------------------ */

/**
 * Below this the text is not a CV — it is a failed extraction that slipped
 * through, and spending a model call on it would produce confident nonsense.
 */
export const MIN_RESUME_TEXT_LENGTH = 40;

/**
 * Generous, because the bound that matters is the 1 MB JSON body limit and the
 * fact that the model only ever reads the first ~14 000 characters anyway.
 *
 * It is *not* tight, because the scorer reads the whole text: length, word count
 * and section headings all decide points on the CV Structure category, so a
 * truncated document would be scored as a worse CV than it is.
 */
export const MAX_RESUME_TEXT_LENGTH = 120_000;

/**
 * The text of a CV the browser extracted on a previous call, sent back to be
 * re-analysed. Nothing else about that version is trusted or needed.
 */
export function validateResumeText(payload = {}) {
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";

  if (text.length < MIN_RESUME_TEXT_LENGTH) {
    throw new ValidationError("That resume has no readable text to analyse.");
  }
  if (text.length > MAX_RESUME_TEXT_LENGTH) {
    throw new ValidationError(
      `Resume text must be ${MAX_RESUME_TEXT_LENGTH} characters or fewer.`,
    );
  }

  return { text };
}

export function validateLabel(value) {
  const label = asString(value);

  if (!label) return "Main";
  if (label.length > 60) {
    throw new ValidationError("Version label must be 60 characters or fewer.");
  }

  return label;
}

export const MIN_JOB_DESCRIPTION_LENGTH = 80;
export const MAX_JOB_DESCRIPTION_LENGTH = 12_000;

export function validateJobDescription({ jobDescription, jobTitle, company } = {}) {
  const description = asString(jobDescription);

  if (description.length < MIN_JOB_DESCRIPTION_LENGTH) {
    throw new ValidationError(
      `Paste at least ${MIN_JOB_DESCRIPTION_LENGTH} characters of job description.`,
    );
  }
  if (description.length > MAX_JOB_DESCRIPTION_LENGTH) {
    throw new ValidationError(
      `Job description must be ${MAX_JOB_DESCRIPTION_LENGTH} characters or fewer.`,
    );
  }

  return {
    jobDescription: description,
    jobTitle: asString(jobTitle).slice(0, 120),
    company: asString(company).slice(0, 120),
  };
}

/** "Improve my CV": only the three fields the prompt actually reads. */
export function validateImproveRequest(payload = {}) {
  const input = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};

  return {
    profile: sanitiseProfile(input.profile),
    weaknesses: toStringList(input.weaknesses, 10, 300),
    recommendations: toStringList(input.recommendations, 12, 400),
  };
}

/**
 * The versions to compare, in the order the browser sent them. The analysis of
 * each is the only part that carries weight; the rest is column labelling.
 */
export function validateCompareRequest(payload = {}) {
  const versions = Array.isArray(payload?.versions) ? payload.versions : [];

  if (versions.length < 2) {
    throw new ValidationError("Select at least two CV versions to compare.");
  }
  if (versions.length > 5) {
    throw new ValidationError("You can compare up to five versions at a time.");
  }

  return versions.map((entry) => {
    const source = entry && typeof entry === "object" ? entry : {};

    return {
      resumeId: toText(source.resumeId, 64),
      label: toText(source.label, 60) || "Main",
      originalName: toText(source.originalName, 255),
      createdAt: toDate(source.createdAt),
      analysis: sanitiseAnalysis(source.analysis),
    };
  });
}

/**
 * The candidate side of a job match: an analysis the browser kept from an
 * earlier call. Scored against a posting the browser also supplied.
 *
 * A missing analysis is refused rather than coerced. Coercion is right for a
 * field inside a payload — a stored analysis is our own output and has to
 * survive the round trip — but an absent one means the caller has nothing to
 * score, and quietly scoring an empty candidate against a posting would return a
 * confident number derived from nothing.
 *
 * A *thin* analysis is a different thing and is allowed: a CV the parser found
 * two skills in is a real CV, and the low score with an explanatory note is the
 * honest answer to it.
 */
export function validateMatchRequest(payload = {}) {
  const input = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};

  const analysis = input.analysis;

  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
    throw new ValidationError("Analyse this resume before matching it against a job.");
  }

  return {
    // Only ever echoed back to the same browser that sent it, so it is a label
    // rather than a lookup key.
    resumeId: toText(input.resumeId, 64),
    analysis: sanitiseAnalysis(analysis),
    ...validateJobDescription(input),
  };
}

/* ------------------------------------------------------------------ *
 * Coercion helpers — shared by the sanitisers above
 * ------------------------------------------------------------------ */

function toText(value, max = 400) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : String(value);
  return text.trim().slice(0, max);
}

function toNumber(value, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value) {
  return value === true || value === "true";
}

/** A list of plain strings, with anything unusable dropped rather than rejected. */
function toStringList(value, max = 60, maxLength = 300) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => toText(entry, maxLength))
    .filter(Boolean)
    .slice(0, max);
}

/** An array of objects, capped. Anything not an object is not a row. */
function toRows(value, max = 30) {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === "object" && !Array.isArray(row)).slice(0, max);
}

function toDate(value) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sanitiseProfile(value) {
  const source = toRows(value, 1)[0] ?? {};

  return {
    fullName: toText(source.fullName ?? source.name, 120),
    email: toText(source.email, 160).toLowerCase(),
    phone: toText(source.phone, 40),
    location: toText(source.location, 160),
    summary: toText(source.summary ?? source.objective, 2000),
    links: toStringList(source.links ?? source.urls, 10, 300),
  };
}

/**
 * An analysis reduced to the fields the scorers and the prompts read, with every
 * type coerced and every collection capped.
 *
 * This is the same set `buildAnalysis` returns, which is what makes the round
 * trip lossless: an analysis the browser kept comes back out of here shaped
 * exactly like a fresh one, so re-running the "Improve my CV" prompt against a
 * stored analysis produces the same request as running it against the original.
 */
export function sanitiseAnalysis(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  return {
    id: toText(source.id, 64),
    score: Math.min(100, Math.max(0, Math.round(toNumber(source.score)))),
    scoreBreakdown: toRows(source.scoreBreakdown, 12).map((row) => ({
      key: toText(row.key, 40),
      label: toText(row.label, 60),
      weight: toNumber(row.weight),
      score: toNumber(row.score),
      earned: toNumber(row.earned),
      note: toText(row.note, 400),
    })),
    profile: sanitiseProfile(source.profile),
    skills: toRows(source.skills, 80)
      .map((skill) => ({
        name: toText(skill.name, 80),
        category: toText(skill.category, 40) || "Other",
        level: toText(skill.level, 40) || "Intermediate",
      }))
      .filter((skill) => skill.name),
    experience: toRows(source.experience, 30)
      .map((role) => {
        const endDate = toText(role.endDate ?? role.end, 20);
        return {
          title: toText(role.title ?? role.role ?? role.position, 120),
          company: toText(role.company ?? role.employer, 120),
          location: toText(role.location, 120),
          startDate: toText(role.startDate ?? role.start, 20),
          endDate,
          current: toBool(role.current) || /present|current|now/i.test(endDate),
          durationMonths: Math.max(0, Math.round(toNumber(role.durationMonths))),
          description: toText(role.description ?? role.highlights, 1200),
        };
      })
      .filter((role) => role.title || role.company),
    education: toRows(source.education, 15)
      .map((entry) => ({
        degree: toText(entry.degree ?? entry.studyType, 120),
        field: toText(entry.field ?? entry.area, 120),
        institution: toText(entry.institution ?? entry.school ?? entry.university, 160),
        startDate: toText(entry.startDate ?? entry.start, 20),
        endDate: toText(entry.endDate ?? entry.end, 20),
        grade: toText(entry.grade, 40),
      }))
      .filter((entry) => entry.degree || entry.institution || entry.field),
    certifications: toRows(source.certifications, 30)
      .map((entry) => ({
        name: toText(entry.name, 160),
        issuer: toText(entry.issuer ?? entry.organization, 120),
        date: toText(entry.date ?? entry.year, 20),
      }))
      .filter((entry) => entry.name),
    languages: toRows(source.languages, 15)
      .map((entry) => ({
        name: toText(entry.name ?? entry.language, 60),
        proficiency: toText(entry.proficiency ?? entry.level, 40),
      }))
      .filter((entry) => entry.name),
    projects: toRows(source.projects, 30)
      .map((project) => ({
        name: toText(project.name ?? project.title, 160),
        description: toText(project.description, 1200),
        technologies: toStringList(project.technologies ?? project.stack ?? project.tech, 25, 80),
        link: toText(project.link ?? project.url, 300),
      }))
      .filter((project) => project.name || project.description),
    keywords: toStringList(source.keywords, 60, 60),
    strengths: toStringList(source.strengths, 10, 300),
    weaknesses: toStringList(source.weaknesses, 10, 300),
    recommendations: toStringList(source.recommendations, 12, 400),
  };
}