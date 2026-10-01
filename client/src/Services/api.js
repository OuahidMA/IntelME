import { API_BASE_URL } from "./config"

/**
 * The intelme data layer.
 *
 * Every call here is a real `fetch` against the Express API, and every one of
 * them is stateless: the browser holds the CVs, so it sends whatever the call
 * needs and the server answers with a result. Nothing is fetched back that was
 * not just asked for, and nothing is stored on the way through.
 *
 * Server documents are mapped onto the shapes the UI was built around
 * (`analysis.atsScore`, `match.overallScore`, and so on) so the pages stay
 * unchanged while the data behind them is now owned by the browser rather than
 * by a database — see `localStore.js` for what is kept, and where.
 *
 * Two things are stored in `localStorage`: the JWT, and the user's own documents.
 * There is no server-side session to revoke, so a stored JWT is what the app
 * sends as a bearer token on every protected route.
 *
 * The backend origin comes from `./config.js` and nowhere else — there is no URL
 * literal in this file — so switching environments is `VITE_API_URL` alone.
 */

const TOKEN_KEY = "intelme.token"

/* ------------------------------------------------------------------ *
 * Token storage
 * ------------------------------------------------------------------ */

export function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    // Private mode and full quotas both throw here. The session then lasts for
    // as long as this tab is open, which is better than failing to sign in.
    return null
  }
}

function setToken(token) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* see getToken() */
  }
}

function clearToken() {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* see getToken() */
  }
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

/** An error carrying the HTTP status, so callers can tell 401 from 502. */
export class ApiError extends Error {
  constructor(message, status, details, data) {
    super(message)
    this.name = "ApiError"
    this.status = status
    /** Per-field messages the server sent, keyed by field name. */
    this.details = details
    /** The parsed response body, when the server sent one. */
    this.data = data
  }
}

/** True when the failure is simply "you are not signed in". */
export function isUnauthorized(error) {
  return error?.status === 401
}

/**
 * A single 401 means the stored token is dead — the account was deleted, the
 * secret rotated, or the expiry passed. Dropping it here stops every later
 * request from replaying a token the server will always reject.
 */
function handleUnauthorized(response) {
  if (response.status !== 401) return
  clearToken()
  window.dispatchEvent(new CustomEvent("intelme:signed-out"))
}

async function request(path, { method = "GET", body, auth = true, signal } = {}) {
  const headers = {}
  const token = auth ? getToken() : null

  if (token) headers.Authorization = `Bearer ${token}`
  // FormData must set its own multipart boundary; assigning Content-Type by
  // hand produces a body the server cannot parse.
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json"
  }

  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    })
  } catch (error) {
    if (error?.name === "AbortError") throw error
    // The cause is kept on the error: a dropped keep-alive socket and a server
    // that is not listening look identical from the outside, and the
    // distinction matters when debugging a flaky run.
    throw new ApiError("Could not reach the intelme server. Check your connection.", 0, {
      cause: error?.cause?.code ?? error?.message ?? String(error),
    })
  }

  handleUnauthorized(response)

  const isJson = (response.headers.get("content-type") ?? "").includes("application/json")
  const payload = isJson ? await response.json().catch(() => null) : null

  if (!response.ok) {
    throw new ApiError(
      payload?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      // The error middleware reports per-field problems under `errors`, so that
      // is what a form has to read to highlight the offending input. Reading
      // `details` here — the name this class uses internally — found nothing,
      // and every field message the server wrote was dropped on the floor.
      payload?.errors,
      // The whole body, so a caller can recover a result the server managed to
      // produce before it hit a failure — an upload whose analysis failed still
      // returned the text it parsed, and re-uploading would duplicate the version.
      payload,
    )
  }

  return payload ?? {}
}

/* ------------------------------------------------------------------ *
 * Mapping helpers
 * ------------------------------------------------------------------ */

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
]

/**
 * Coerces whatever the model wrote for a date into the `YYYY-MM` the timeline
 * component requires. `ExperienceTimeline` does `new Date(\`${value}-01\`)`, so
 * a looser string becomes `Invalid Date` and the row renders "NaN months".
 * Returns `null` when the text holds no month we can read, and the caller drops
 * that role rather than showing a broken one.
 */
export function toMonth(value) {
  if (!value) return null
  const text = String(value).trim().toLowerCase()
  if (!text) return null

  if (/^\d{4}-\d{2}$/.test(text)) return text
  if (text === "present" || text === "current" || text === "now") return null

  // "2021-03-01", "2021/3", "2021.03"
  let match = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/)
  if (match) {
    const month = Number(match[2])
    if (month >= 1 && month <= 12) return `${match[1]}-${String(month).padStart(2, "0")}`
  }

  // "03/2021", "3-2021"
  match = text.match(/^(\d{1,2})[-/.](\d{4})$/)
  if (match) {
    const month = Number(match[1])
    if (month >= 1 && month <= 12) return `${match[2]}-${String(month).padStart(2, "0")}`
  }

  // "March 2021", "Mar 2021", "march, 2021"
  match = text.match(/^([a-z]+)[,\s]+(\d{4})$/)
  if (match) {
    // "mar" has to reach "march" and "may" only matches itself, so compare the
    // first three characters against each month name.
    const index = MONTH_NAMES.findIndex((name) => name.startsWith(match[1].slice(0, 3)))
    if (index >= 0) return `${match[2]}-${String(index + 1).padStart(2, "0")}`
  }

  // "2021" on its own means January.
  match = text.match(/^(\d{4})$/)
  if (match) return `${match[1]}-01`

  return null
}

/** A confidence percentage per skill, from the level the model assigned. */
const LEVEL_CONFIDENCE = {
  expert: 95,
  advanced: 85,
  proficient: 80,
  intermediate: 70,
  competent: 65,
  beginner: 55,
  novice: 45,
}

function confidenceOf(level) {
  const key = String(level ?? "").trim().toLowerCase()
  if (LEVEL_CONFIDENCE[key]) return LEVEL_CONFIDENCE[key]
  if (key.startsWith("expert")) return 95
  if (key.startsWith("advanced")) return 85
  if (key.startsWith("beginner") || key.startsWith("novice")) return 55
  return 70
}

/** The breakdown rows double as the checklist the score card renders. */
function toChecks(breakdown) {
  return (breakdown ?? []).map((row) => ({
    label: `${row.label} — ${row.weight}% of your score`,
    // The card only styles pass / warn / fail, and `warn` is exactly the
    // middle band: enough content to score, not enough to be confident.
    status: row.score >= 80 ? "pass" : row.score >= 60 ? "warn" : "fail",
    score: row.score,
    weight: row.weight,
    earned: row.earned,
    note: row.note,
  }))
}

/**
 * Server analysis + the version it came from → the shape `Analysis.jsx` and
 * `Dashboard.jsx` read. The extra keys past what those two pages use are kept
 * deliberately: the breakdown, the extracted sections and the recommendations are
 * what make the score explainable rather than a bare number.
 *
 * Exported because the provider maps the *stored* analysis of whichever version
 * is selected, including one produced by a re-run, against a resume record that
 * never came back from the server at all.
 */
export function mapAnalysis(analysis, resume) {
  if (!analysis) return null

  const source = analysis
  const meta = typeof resume === "object" && resume ? resume : analysis.resume

  const experience = (source.experience ?? [])
    .map((entry, index) => {
      const start = toMonth(entry.startDate)
      const end = entry.current ? null : toMonth(entry.endDate)

      // The timeline cannot render a role with no readable start month.
      if (!start) return null

      return {
        id: `${source.id ?? "role"}-${index}`,
        role: entry.title || "Role not named",
        company: entry.company || "Company not named",
        start,
        end,
        current: Boolean(entry.current),
        summary: entry.description || "",
        location: entry.location ?? "",
        durationMonths: entry.durationMonths ?? 0,
      }
    })
    .filter(Boolean)

  const suggestions = (source.recommendations ?? []).filter(Boolean).slice(0, 4)

  return {
    id: source.id ?? null,
    resumeId: meta?.id ?? meta?._id ?? null,
    fileName: meta?.originalName ?? "your resume",
    label: meta?.label ?? "Main",
    fileType: meta?.fileType ?? "",
    createdAt: source.createdAt ?? null,

    atsScore: source.score ?? 0,
    verdict: source.verdict ?? "",
    checks: toChecks(source.scoreBreakdown),
    scoreBreakdown: source.scoreBreakdown ?? [],
    // The score card sizes its bars from the array index, so a longer list
    // renders a negative bar. Four is the hard ceiling.
    suggestions,

    role: experience[0]?.role ?? "",
    profile: source.profile ?? {},
    skills: {
      matched: (source.skills ?? []).map((skill) => ({
        label: skill.name,
        category: skill.category,
        level: skill.level,
        confidence: confidenceOf(skill.level),
      })),
      // A CV has no "missing" skills in the job-matching sense: there is no
      // posting to be missing them from.
      missing: [],
    },
    allSkills: source.skills ?? [],
    experience,
    education: source.education ?? [],
    projects: source.projects ?? [],
    certifications: source.certifications ?? [],
    languages: source.languages ?? [],
    keywords: source.keywords ?? [],
    strengths: source.strengths ?? [],
    weaknesses: source.weaknesses ?? [],
    recommendations: source.recommendations ?? [],
    improvements: source.improvements ?? null,
  }
}

/**
 * Server job match → the shape `JobMatchCard` renders.
 *
 * Exported because the `extras` list is derived from the candidate's own skills,
 * so a newly created match and one reopened from history both need the analysis
 * that is cached in the resume context.
 */
export function toMatchResult(job, analysis) {
  if (!job) return null

  const matched = (job.matchingSkills ?? []).map((skill) => ({
    requirement: skill.name,
    evidence: skill.evidence || "",
  }))

  const missing = (job.missingSkills ?? []).map((skill) => ({
    requirement: skill.name,
    importance: skill.importance,
    hint: skill.hint || "",
  }))

  // Extras are the candidate's own skills the posting never asked for. Deriving
  // them from the two lists above keeps the panel honest: anything the posting
  // mentioned is either in `matched` or in `missing`, so whatever is left is
  // genuinely a bonus.
  const mentioned = new Set(
    [...matched, ...missing].map((row) => row.requirement.toLowerCase()),
  )
  const extras = (analysis?.allSkills ?? [])
    .map((skill) => skill.name)
    .filter((name) => name && !mentioned.has(name.toLowerCase()))
    .map((name) => ({ requirement: name }))

  return {
    id: job.id ?? null,
    resumeId: job.resumeId ?? job.resume ?? null,
    jobTitle: job.jobTitle || "Untitled role",
    company: job.company || "",
    jobDescription: job.jobDescription ?? "",
    createdAt: job.createdAt ?? null,

    overallScore: job.score ?? 0,
    verdict: job.verdict || "",
    summary: job.summary || "",
    scoreBreakdown: job.scoreBreakdown ?? [],
    matched,
    missing,
    extras,

    matchingExperience: job.matchingExperience ?? {},
    matchingEducation: job.matchingEducation ?? {},
    strengths: job.strengths ?? [],
    gaps: job.gaps ?? [],
    recommendations: job.recommendations ?? [],
  }
}

/**
 * The `{ name, size, type }` chip the dashboard shows, from the resume record
 * the server returned for one upload. Used once, when the version is written to
 * this browser for the first time.
 */
export function mapResumeMeta(resume) {
  if (!resume) return null
  return {
    name: resume.originalName ?? "resume",
    size: resume.fileSize ?? 0,
    type: (resume.fileType ?? "").toUpperCase(),
    label: resume.label ?? "Main",
    extractionMethod: resume.extractionMethod,
    characters: resume.characters ?? 0,
    createdAt: resume.createdAt,
  }
}

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

function initialsOf(name) {
  return String(name ?? "")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

/** Server user → the session object the sidebar renders. */
export function toSession(user) {
  if (!user) return null
  const name = user.name ?? ""
  return {
    id: user.id ?? null,
    // The UI calls this field `username`; the schema calls it `name`.
    username: name,
    email: user.email ?? "",
    initials: initialsOf(name),
  }
}

export async function register({ username, email, password }) {
  const data = await request("/auth/register", {
    method: "POST",
    auth: false,
    body: { name: username, email, password },
  })

  setToken(data.token)
  return toSession(data.user)
}

export async function login({ identifier, password }) {
  const data = await request("/auth/login", {
    method: "POST",
    auth: false,
    // The form field is "email or username"; the endpoint expects `email`.
    body: { email: String(identifier ?? "").trim().toLowerCase(), password },
  })

  setToken(data.token)
  return toSession(data.user)
}

export async function getMe() {
  const data = await request("/auth/me")
  return toSession(data.user)
}

/**
 * PATCH /api/auth/me
 *
 * Only the fields that actually changed are sent: the server rejects an empty
 * patch, and there is no reason to write a row just to store the same values.
 * Returns the new session, so the caller can replace the one it holds without
 * a second round-trip.
 */
export async function updateProfile(patch) {
  const body = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.email !== undefined) body.email = patch.email

  const data = await request("/auth/me", { method: "PATCH", body })
  return toSession(data.user)
}

/**
 * PATCH /api/auth/me/password
 *
 * The server verifies the current password, re-hashes the new one and stores
 * that hash — the plaintext never reaches the database. A wrong current
 * password is a 400 with the message "Your current password is not correct.",
 * and field problems arrive in `error.details`.
 */
export async function changePassword({ currentPassword, newPassword }) {
  return request("/auth/me/password", {
    method: "PATCH",
    body: { currentPassword, newPassword },
  })
}

/**
 * DELETE /api/auth/me
 *
 * Removes the account document — a name, an email and a password hash, which is
 * all the database holds. Nothing here cascades, because nothing about a CV was
 * ever written to it.
 *
 * The stored token is dropped here, and `AuthContext.deleteAccount` clears the
 * browser's own copy of the versions and matches: the account it belonged to no
 * longer exists, so the data has to go with it.
 */
export async function deleteAccount() {
  const data = await request("/auth/me", { method: "DELETE" })
  clearToken()
  return data
}

export function logout() {
  clearToken()
}

/** True when a token is stored, so a reload can skip the `/auth/me` round-trip. */
export function hasStoredToken() {
  return Boolean(getToken())
}

/* ------------------------------------------------------------------ *
 * Resumes and versions
 *
 * Four stateless calls. Each one is given whatever it needs and returns a result;
 * none of them reads a stored document, because there is nothing stored.
 * ------------------------------------------------------------------ */

/**
 * Sends a file up, gets its text and its analysis back, and stores nothing.
 *
 * The server deletes the upload as soon as it has parsed it, so the response is
 * the only copy: `resume.extractedText` is the CV, and it has to be kept by
 * whoever made this call. `localStore.js` is that whoever.
 *
 * When the text was recovered but the AI call did not succeed, the server
 * answers 502 with the resume it produced and `canRetry: true`. That resume is
 * returned here rather than thrown away: the version is real and useful, and
 * re-uploading would leave the user with a duplicate. The caller gets
 * `analysis: null` and can re-run the analysis on the text it already holds.
 *
 * Both `resume` and `analysis` are returned in the server's own shape, not the
 * one the pages read. They are stored as-is — the analysis has to travel back to
 * the server intact to be scored against a posting — and `mapAnalysis` is applied
 * at the point of display instead.
 */
export async function uploadResume(file, { label } = {}) {
  const body = new FormData()
  body.append("file", file)
  if (label) body.append("label", label)

  try {
    const data = await request("/resumes/analyse", { method: "POST", body })
    return { resume: data.resume ?? null, analysis: data.analysis ?? null }
  } catch (error) {
    const parsed = error?.data?.resume
    if (parsed) {
      return {
        resume: parsed,
        analysis: null,
        canRetry: true,
        reason: error.message,
      }
    }
    throw error
  }
}

/**
 * POST /api/analysis — re-runs the analysis on text this browser already holds.
 *
 * This is what "Re-run analysis" does: it sends the stored text back rather than
 * asking the user to find and re-upload the file they gave us minutes ago. The
 * result is in the server's own shape, ready to be stored as-is.
 */
export async function reanalyse(text) {
  const data = await request("/analysis", { method: "POST", body: { text } })
  return data.analysis ?? null
}

/** POST /api/analysis/improve — "Improve My CV", from a stored analysis. */
export async function improveCv(analysis) {
  const data = await request("/analysis/improve", {
    method: "POST",
    body: {
      profile: analysis?.profile ?? {},
      weaknesses: analysis?.weaknesses ?? [],
      recommendations: analysis?.recommendations ?? [],
    },
  })

  return {
    improvedSummary: data.improvements?.improvedSummary ?? "",
    suggestions: data.improvements?.suggestions ?? [],
    rewrittenBullets: data.improvements?.rewrittenBullets ?? [],
    disclaimer: data.improvements?.disclaimer ?? "",
  }
}

/**
 * POST /api/analysis/compare — two to five versions side by side.
 *
 * The versions travel in the body because the browser is what holds them. The
 * arithmetic stays on the server, next to the scoring it reads, so there is one
 * implementation of "which version wins" rather than two.
 *
 * @param {Array<{id: string, label: string, originalName: string, createdAt: string, analysis: object}>} versions
 */
export async function compareVersions(versions) {
  const data = await request("/analysis/compare", {
    method: "POST",
    body: {
      versions: versions.map((version) => ({
        resumeId: version.id,
        label: version.label,
        originalName: version.originalName,
        createdAt: version.createdAt,
        analysis: version.analysis,
      })),
    },
  })

  return {
    versions: data.versions ?? [],
    rows: data.rows ?? [],
    winner: data.winner ?? null,
  }
}

/**
 * What the server accepts.
 *
 * The uploader validates against its own copy of these rules so a wrong format is
 * caught before a round-trip, and the endpoint exists so the two cannot drift
 * apart unnoticed.
 */
export async function getUploadLimits() {
  return request("/resumes/limits")
}

/* ------------------------------------------------------------------ *
 * Job matching
 * ------------------------------------------------------------------ */

/**
 * POST /api/jobs/match
 *
 * The candidate side of the comparison is an analysis this browser kept from an
 * earlier call, so it travels in the body. The match comes back and is kept here.
 */
export async function createMatch({ analysis, resumeId, jobDescription, jobTitle, company }) {
  const data = await request("/jobs/match", {
    method: "POST",
    body: { analysis, resumeId, jobDescription, jobTitle, company },
  })
  return data.match
}

/* ------------------------------------------------------------------ *
 * Client-side job requirement preview
 *
 * This is a browser-only convenience: it shows which parts of a pasted posting
 * were picked up *before* the AI call. The scored match never uses it.
 * ------------------------------------------------------------------ */

const SKILL_LIBRARY = {
  engineering: ["React", "TypeScript", "Node.js", "GraphQL", "Vite", "Playwright", "Python", "Docker"],
  design: ["Figma", "Design systems", "Prototyping", "User research", "Accessibility"],
  product: ["Roadmapping", "Discovery interviews", "A/B testing", "SQL", "Stakeholder management"],
  data: ["Python", "SQL", "dbt", "Airflow", "Looker", "Statistics"],
}

const STOP_WORDS = new Set(
  `a an the and or but if then than that this these those of in on at to for with
   we you they our your their is are was were be been being do does did will would
   can could should may might must have has had as by from about into over under
   across work working works experience experienced team teams role years year
   plus bonus ability able strong excellent good great new like etc via per
   responsibilities requirements qualifications skills experience candidates
   applicant applicants position company role job description about what who how`
    .split(/\s+/)
    .filter(Boolean),
)

export function extractJobRequirements(jobDescription) {
  if (!jobDescription?.trim()) return []

  const text = jobDescription.toLowerCase()
  const found = new Map()

  for (const [, library] of Object.entries(SKILL_LIBRARY)) {
    for (const skill of library) {
      const needle = skill.toLowerCase()
      const index = text.indexOf(needle)
      if (index === -1) continue

      const before = text.slice(Math.max(0, index - 24), index)
      const required = /\b(must|required|requires|essential)\b/.test(before)

      found.set(skill, { label: skill, required })
    }
  }

  // Longer phrases first so "user research" wins over the single word "research".
  const phrases = new Set()
  for (const phrase of text.split(/[^a-z+#.]+/)) {
    const cleaned = phrase.replace(/^[.]+|[.]+$/g, "")
    if (cleaned.length < 4 || STOP_WORDS.has(cleaned)) continue
    if (found.has(cleaned)) continue
    phrases.add(cleaned)
  }

  return [
    ...Array.from(found.values()),
    ...Array.from(phrases, (label) => ({ label, required: false })),
  ].slice(0, 24)
}
