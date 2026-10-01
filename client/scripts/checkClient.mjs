/**
 * Exercises the real client data layer against the running API.
 *
 * Lint and build prove the module parses; they say nothing about whether the
 * mappers produce the shapes the pages render, or whether the browser-side store
 * behaves. This drives `src/Services/api.js` and `src/Services/localStore.js`
 * through the journey a user does — sign up, upload, read, score, match, improve,
 * compare, clean up — and asserts the invariants the components depend on,
 * including the ones that would otherwise fail silently in the browser (a null
 * array turning into `Cannot read .length of null`, a `YYYY-MM` date becoming
 * `Invalid Date`, a stored workspace silently not persisting).
 *
 * The centre of gravity is different now that nothing is stored server-side: the
 * store has to be trustworthy, because it is the only copy of the CV. So the
 * store gets exercised directly — round trips, a full origin, corrupt JSON, a
 * shape from another version, two accounts on one browser — and the API journey
 * asserts that a full product flow ends with everything in the browser and
 * nothing in the response.
 *
 * Usage: node scripts/checkClient.mjs   (with the server already listening)
 */

import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(here, "../../server/uploads/__fixtures__")
const UPLOADS = path.resolve(here, "../../server/uploads")

/** How many files are sitting in the server's upload directory. */
async function countUploads() {
  const entries = await readdir(UPLOADS, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isFile()).length
}

/* ------------------------------------------------------------------ *
 * A localStorage with the parts we depend on, and one fault to inject
 * ------------------------------------------------------------------ */

const store = new Map()

/** Set to make `setItem` throw, which is what a full or blocked origin does. */
let setItemFails = false

const localStorageStub = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => {
    if (setItemFails) {
      const error = new Error("quota")
      error.name = "QuotaExceededError"
      throw error
    }
    store.set(key, String(value))
  },
  removeItem: (key) => store.delete(key),
  get length() {
    return store.size
  },
}

globalThis.window = {
  localStorage: localStorageStub,
  dispatchEvent: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.localStorage = globalThis.window.localStorage
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type
    this.detail = init?.detail
  }
}

const api = await import("../src/Services/api.js")
const localStore = await import("../src/Services/localStore.js")
const { API_BASE_URL, API_ORIGIN } = await import("../src/Services/config.js")

// This script must exercise the backend the app would actually talk to, or it is
// testing a different deployment. Point it elsewhere with `VITE_API_URL`.
console.log(`API under test: ${API_BASE_URL}\n`)

/* ------------------------------------------------------------------ *
 * Assertions
 * ------------------------------------------------------------------ */

let passed = 0
const failures = []
const skips = []

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`)
  } else {
    failures.push(label)
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

/**
 * Records a step that could not run because the upstream model refused or
 * mis-structured the document. Tracked separately from failures so a flaky
 * provider can never be mistaken for a broken build — and never quietly pass
 * either.
 */
function skip(label, reason) {
  skips.push(`${label}: ${reason}`)
  console.log(`  SKIP ${label} — ${reason}`)
}

/** True when an error came from the model rather than from our own code. */
function isAiFailure(error) {
  const message = String(error?.message ?? "")
  return (
    error?.status === 502 ||
    error?.status === 429 ||
    /rate limited|structured result|AI is not configured|Groq|rate limit/i.test(message)
  )
}

/** Thrown when the run cannot continue because the model never cooperated. */
class AiUnavailable extends Error {}

/** Runs an AI-dependent step, skipping it if the provider is the problem. */
async function withAi(label, fn) {
  try {
    return await fn()
  } catch (error) {
    if (isAiFailure(error)) {
      skip(label, error.message)
      return null
    }
    throw error
  }
}

const section = (name) => console.log(`\n${name}`)

/* ------------------------------------------------------------------ *
 * The browser-side store — the only copy of the CV, so tested directly
 * ------------------------------------------------------------------ */

section("The browser store")

{
  const owner = "account-a"
  const other = "account-b"

  check("a fresh account reads an empty workspace", localStore.getWorkspace(owner).resumes.length === 0)
  check("the empty snapshot is the same object every read", localStore.getWorkspace(owner) === localStore.getWorkspace(owner))

  localStore.updateWorkspace(owner, (previous) => ({
    ...previous,
    resumes: [{ id: "r1", originalName: "cv.pdf", analysis: { score: 71 }, extractedText: "text" }],
  }))

  const stored = localStore.getWorkspace(owner)
  check("a written version reads back", stored.resumes.length === 1 && stored.resumes[0].id === "r1")
  check("the raw analysis survives the round trip", stored.resumes[0].analysis.score === 71)
  check("the extracted text survives the round trip", stored.resumes[0].extractedText === "text")
  check("another account cannot see it", localStore.getWorkspace(other).resumes.length === 0)

  // The parse cache must miss when the stored text moves, or a `useSyncExternalStore`
  // reader would be handed the same object and never re-render.
  localStore.updateWorkspace(owner, (previous) => ({ ...previous, matches: [{ id: "m1", score: 40 }] }))
  check("a second write is visible immediately", localStore.getWorkspace(owner).matches.length === 1)
  check("the snapshot identity changed with the data", localStore.getWorkspace(owner) !== stored)

  // Two changes before any re-render: the second must build on the first, not on
  // a stale copy. This is what `updateWorkspace` reading from the store buys.
  localStore.updateWorkspace(owner, (previous) => ({
    ...previous,
    resumes: [...previous.resumes, { id: "r2", originalName: "cv2.pdf" }],
  }))
  localStore.updateWorkspace(owner, (previous) => ({
    ...previous,
    resumes: [...previous.resumes, { id: "r3", originalName: "cv3.pdf" }],
  }))
  check("consecutive writes compose rather than overwrite", localStore.getWorkspace(owner).resumes.length === 3, `${localStore.getWorkspace(owner).resumes.length} versions`)

  const footprint = localStore.storageFootprint(owner)
  check("the footprint is a plausible size", footprint > 0 && footprint < 1000, `${footprint} bytes`)
  check("an empty account costs nothing", localStore.storageFootprint(other) === 0)

  // A full origin must be reported, not swallowed: the user just spent an AI
  // call on that CV and has to be told it was not saved.
  setItemFails = true
  let quotaError = null
  try {
    localStore.writeWorkspace(owner, { resumes: [{ id: "r4" }], matches: [] })
  } catch (error) {
    quotaError = error
  }
  setItemFails = false

  check("a full origin raises LocalStoreError", quotaError?.name === "LocalStoreError", quotaError?.name)
  check("the message says what to do about it", /storage space/i.test(quotaError?.message ?? ""), quotaError?.message?.slice(0, 60))
  check("nothing was written when the write failed", localStore.getWorkspace(owner).resumes.length === 3, `${localStore.getWorkspace(owner).resumes.length} versions`)

  // Corrupt or foreign data is discarded rather than half-believed.
  store.set("intelme.data.account-b", "{not json")
  check("corrupt JSON reads as an empty workspace", localStore.getWorkspace(other).resumes.length === 0)

  store.set("intelme.data.account-b", JSON.stringify({ version: 99, resumes: [{ id: "x" }], matches: [] }))
  check("a workspace from another version is discarded", localStore.getWorkspace(other).resumes.length === 0)

  store.set("intelme.data.account-b", JSON.stringify({ version: 1, resumes: "not an array", matches: [] }))
  check("a half-written workspace is discarded", localStore.getWorkspace(other).resumes.length === 0)

  localStore.clearWorkspace(owner)
  check("clearing one account empties it", localStore.getWorkspace(owner).resumes.length === 0)
}

section("Projections over the store (pure, no browser needed)")

{
  const workspace = {
    version: 1,
    resumes: [
      { id: "v1", label: "Main", originalName: "old.pdf", fileType: "pdf", fileSize: 10, createdAt: "2026-01-01T00:00:00.000Z", analysis: { score: 60, verdict: "Ok" }, extractedText: "a" },
      { id: "v2", label: "Frontend", originalName: "new.docx", fileType: "docx", fileSize: 20, createdAt: "2026-06-01T00:00:00.000Z", analysis: { score: 80, verdict: "Good" }, extractedText: "b" },
    ],
    matches: [
      { id: "m1", resumeId: "v1", jobTitle: "Frontend Developer", company: "Acme", score: 40, createdAt: "2026-02-01T00:00:00.000Z", matchingSkills: [{ name: "React" }], missingSkills: [{ name: "Go" }] },
      { id: "m2", resumeId: "v2", jobTitle: "Full Stack Engineer", company: "Globex", score: 90, createdAt: "2026-05-01T00:00:00.000Z", matchingSkills: [{ name: "TypeScript" }], missingSkills: [] },
      { id: "m3", resumeId: "v2", jobTitle: "Designer", company: "Initech", score: 20, createdAt: "2026-04-01T00:00:00.000Z", matchingSkills: [], missingSkills: [{ name: "Figma" }] },
    ],
  }

  const sorted = localStore.sortVersions(workspace.resumes)
  check("versions sort newest first", sorted[0].id === "v2", sorted.map((r) => r.id).join(", "))

  const version = localStore.toVersion(workspace.resumes[1])
  check("a version exposes the { name, size, type } the chip shows", version.name === "new.docx" && version.size === 20 && version.type === "DOCX")
  check("a version carries its score and verdict", version.score === 80 && version.verdict === "Good", `${version.score} / ${version.verdict}`)
  check("a version carries the raw analysis for the server", version.analysis.score === 80)
  check("a version carries the text a re-run is made of", version.extractedText === "b")

  const history = localStore.summariseMatches(workspace)
  check("history defaults to newest first", history[0].id === "m2", history.map((r) => r.id).join(", "))
  check("history rows flatten skills to names", history.every((row) => row.matchingSkills.every((name) => typeof name === "string")))
  check("history rows carry a score and a title", history.every((row) => typeof row.score === "number" && row.jobTitle.length > 0))

  const byScore = localStore.summariseMatches(workspace, { sort: "score:desc" })
  check("sorting by score works", byScore.map((r) => r.score).join(" >= ") === "90 >= 40 >= 20", byScore.map((r) => r.score).join(" >= "))

  const ascending = localStore.summariseMatches(workspace, { sort: "score:asc" })
  check("sorting by score ascending works", ascending.map((r) => r.score).join(" < ") === "20 < 40 < 90", ascending.map((r) => r.score).join(" < "))

  const byTitle = localStore.summariseMatches(workspace, { search: "Frontend" })
  check("searching a title finds its matches", byTitle.length === 1 && byTitle[0].id === "m1", `${byTitle.length} hit(s)`)
  const byCompany = localStore.summariseMatches(workspace, { search: "globex" })
  check("searching a company is case-insensitive", byCompany.length === 1 && byCompany[0].id === "m2")
  const byBodyOnly = localStore.summariseMatches(workspace, { search: "zzz-not-a-real-role" })
  check("a term in no title returns nothing", byBodyOnly.length === 0, `${byBodyOnly.length} hit(s)`)

  check("the min filter drops matches below the threshold", localStore.summariseMatches(workspace, { min: 90 }).every((row) => row.score >= 90))
  check("the max filter drops matches above the threshold", localStore.summariseMatches(workspace, { max: 40 }).every((row) => row.score <= 40))
  check("a junk filter does not throw", Array.isArray(localStore.summariseMatches(workspace, { min: "abc", sort: "$where:asc" })))

  const removed = localStore.removeResume(workspace, "v2")
  check("removing a version drops it", removed.resumes.length === 1 && removed.resumes[0].id === "v1")
  check("removing a version drops its matches too", removed.matches.length === 1 && removed.matches[0].id === "m1", `${removed.matches.length} left`)
  check("the original workspace is untouched", workspace.resumes.length === 2 && workspace.matches.length === 3)

  check("newId produces distinct ids", localStore.newId() !== localStore.newId())
}

/* ------------------------------------------------------------------ *
 * Date coercion — pure, so it is checked first and cheaply
 * ------------------------------------------------------------------ */

section("Date coercion (the timeline requires YYYY-MM)")

const MONTH_CASES = [
  ["2021-03", "2021-03"],
  ["2021-3", "2021-03"],
  ["2021/03", "2021-03"],
  ["2021-03-01", "2021-03"],
  ["03/2021", "2021-03"],
  ["March 2021", "2021-03"],
  ["Mar 2021", "2021-03"],
  ["march, 2021", "2021-03"],
  ["May 2020", "2020-05"],
  ["January 2019", "2019-01"],
  ["December 2022", "2022-12"],
  ["2021", "2021-01"],
  ["present", null],
  ["Present", null],
  ["current", null],
  ["", null],
  [null, null],
  [undefined, null],
  ["not a date", null],
  ["Sometime in 2019", null],
]

for (const [input, expected] of MONTH_CASES) {
  check(
    `toMonth(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`,
    api.toMonth(input) === expected,
    `got ${JSON.stringify(api.toMonth(input))}`,
  )
}

/* ------------------------------------------------------------------ *
 * The full journey
 * ------------------------------------------------------------------ */

const email = `client.${Date.now()}@example.com`
const password = "CorrectHorse9!"
// Each entry carries its own password: the settings journey below changes one
// account's password, and the cleanup pass has to sign in with whatever that
// account ended up using.
const accounts = [{ email, password }]

console.log(`\nDriving the client layer as ${email}`)

let analysis = null
let description = ""
const filesAtStart = await countUploads()

try {
  section("Auth")
  const session = await api.register({ username: "Client Tester", email, password })
  check("register returns a session", Boolean(session))
  check("session has initials for the sidebar", session.initials === "CT", session.initials)
  check("session username came from the name field", session.username === "Client Tester")
  check("a token was stored", Boolean(api.getToken()))

  const userId = session.id
  const workspace = () => localStore.getWorkspace(userId)

  const me = await api.getMe()
  check("getMe round-trips the account", me.email === email)

  const badLogin = await api
    .login({ identifier: email, password: "wrong-password" })
    .then(() => null)
    .catch((error) => error)
  check(
    "a wrong password rejects with the server message",
    badLogin?.message === "Email or password incorrect",
    badLogin?.message ?? "(resolved instead of throwing)",
  )

  // Sign back in: the failed attempt above must not have cleared the token.
  const again = await api.login({ identifier: email.toUpperCase(), password })
  check("login is case-insensitive on the email", again.email === email)

  section("Upload")
  const pdf = await readFile(path.join(FIXTURES, "john-doe-cv.pdf"))
  const file = new File([pdf], "client-check.pdf", { type: "application/pdf" })

  const uploaded = await api.uploadResume(file, { label: "Client check" })

  check("the upload returned the text it recovered", (uploaded.resume?.extractedText?.length ?? 0) > 200, `${uploaded.resume?.characters} chars`)
  check("the resume record has no id (the browser names the version)", uploaded.resume?.id === undefined)
  check("the resume record has no server path", !JSON.stringify(uploaded.resume ?? {}).includes("uploads"))

  // This is the shape the provider stores verbatim, so asserting it here is
  // asserting what lands in localStorage.
  analysis = uploaded.analysis

  if (analysis === null) {
    check("the caller is told it can retry", uploaded.canRetry === true)

    const recovered = await withAi("re-run after a failed analysis", () =>
      api.reanalyse(uploaded.resume.extractedText),
    )
    analysis = recovered ?? null
    if (analysis) check("re-running the analysis recovers the version", true, `score ${analysis.score}`)
  } else {
    check("an analysis came back on the first pass", typeof analysis.score === "number", `score ${analysis.score}`)
  }

  section("Keeping the CV in this browser")

  const firstId = localStore.newId()
  localStore.updateWorkspace(userId, (previous) => ({
    ...previous,
    resumes: [
      {
        id: firstId,
        label: "Client check",
        originalName: uploaded.resume.originalName,
        fileType: uploaded.resume.fileType,
        fileSize: uploaded.resume.fileSize,
        extractionMethod: uploaded.resume.extractionMethod,
        characters: uploaded.resume.characters,
        extractedText: uploaded.resume.extractedText,
        createdAt: uploaded.resume.createdAt,
        analysis,
      },
    ],
  }))

  const stored = workspace()
  check("the version is in the browser", stored.resumes.length === 1)
  check("the analysis round-tripped through localStorage", stored.resumes[0].analysis?.score === analysis?.score)
  check("the text round-tripped through localStorage", stored.resumes[0].extractedText.length > 200)

  if (!analysis) {
    // Every remaining section reads this analysis, so there is nothing left to
    // verify. Reported as an infrastructure skip, not a failure of this code.
    throw new AiUnavailable("the model never returned a structured result for the CV")
  }

  section("Analysis mapping (what Analysis.jsx and Dashboard.jsx read)")
  const view = api.mapAnalysis(stored.resumes[0].analysis, stored.resumes[0])
  check("atsScore is a number in 0-100", typeof view.atsScore === "number" && view.atsScore >= 0 && view.atsScore <= 100, String(view.atsScore))
  check("fileName is a non-empty string", typeof view.fileName === "string" && view.fileName.length > 0, view.fileName)
  check("role is never null (it is .toLowerCase()d unguarded)", typeof view.role === "string", JSON.stringify(view.role))
  check("checks is a non-null array", Array.isArray(view.checks) && view.checks.length === 8, `${view.checks.length} rows`)
  check("every check has a label and a known status", view.checks.every((row) => row.label && ["pass", "warn", "fail"].includes(row.status)))
  check("suggestions is capped at 4 (the bar goes negative past that)", view.suggestions.length <= 4, `${view.suggestions.length} suggestions`)
  check("suggestions are plain strings", view.suggestions.every((row) => typeof row === "string"))
  check("recommendations survived the cap", view.recommendations.length > 0, `${view.recommendations.length}`)
  check("skills.matched is a non-null array", Array.isArray(view.skills.matched) && view.skills.matched.length > 0, `${view.skills.matched.length} skills`)
  check("skills.missing is a non-null array", Array.isArray(view.skills.missing))
  check("every matched skill has a label and a numeric confidence", view.skills.matched.every((skill) => skill.label && typeof skill.confidence === "number"))
  check("every matched skill has a category", view.skills.matched.every((skill) => Boolean(skill.category)))
  check("scoreBreakdown has 8 weighted rows", view.scoreBreakdown.length === 8)
  check("the earned values sum to the headline score", (() => {
    const total = view.scoreBreakdown.reduce((sum, row) => sum + row.earned, 0)
    return Math.abs(total - view.atsScore) < 1
  })())

  section("Experience timeline contract")
  check("experience is a non-null array", Array.isArray(view.experience))
  check("every role has a unique id (it is the React key)", (() => {
    const ids = view.experience.map((role) => role.id)
    return new Set(ids).size === ids.length && ids.every(Boolean)
  })(), `${view.experience.length} roles`)
  check("every start parses as a real date (YYYY-MM)", view.experience.every((role) => !Number.isNaN(new Date(`${role.start}-01T00:00:00`).getTime())), view.experience.map((r) => r.start).join(", "))
  check("every non-current end parses as a real date", view.experience.every((role) => role.current || !Number.isNaN(new Date(`${role.end}-01T00:00:00`).getTime())))
  check("no role renders an 'Invalid Date' label", view.experience.every((role) => !String(role.start).includes("Invalid")))

  section("Second version")
  const docx = await readFile(path.join(FIXTURES, "john-doe-cv.docx"))
  const second = await api.uploadResume(
    new File([docx], "client-check.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    { label: "Second" },
  )

  const secondId = localStore.newId()
  localStore.updateWorkspace(userId, (previous) => ({
    ...previous,
    resumes: [
      {
        id: secondId,
        label: "Second",
        originalName: second.resume.originalName,
        fileType: second.resume.fileType,
        fileSize: second.resume.fileSize,
        extractionMethod: second.resume.extractionMethod,
        characters: second.resume.characters,
        extractedText: second.resume.extractedText,
        createdAt: second.resume.createdAt,
        analysis: second.analysis,
      },
      ...previous.resumes,
    ],
  }))

  const two = workspace()
  check("both versions are in the browser", two.resumes.length === 2, `${two.resumes.length}`)
  check("the newest version sorts first", localStore.sortVersions(two.resumes)[0].id === secondId)
  check("the newest version still has its analysis", two.resumes[0].analysis?.score !== undefined)

  section("Re-analysis from stored text")
  const refreshed = await withAi("re-analysis", () => api.reanalyse(two.resumes[1].extractedText))
  if (refreshed) {
    check("re-running the analysis returns a fresh score", typeof refreshed.score === "number", String(refreshed.score))
    check("the re-analysis is still a valid 8-row breakdown", refreshed.scoreBreakdown.length === 8)
    check("each analysis is minted fresh", refreshed.id !== two.resumes[1].analysis?.id)

    localStore.updateWorkspace(userId, (previous) => ({
      ...previous,
      resumes: previous.resumes.map((resume) =>
        resume.id === two.resumes[1].id ? { ...resume, analysis: refreshed } : resume,
      ),
    }))
    check("the re-analysis replaced the stored one", workspace().resumes[1].analysis?.id === refreshed.id)
  } else {
    skip("re-analysis assertions", "the model did not return a structured result")
  }

  section("Job match")
  description = await readFile(path.join(FIXTURES, "job.txt"), "utf8").catch(() => `We are hiring a Frontend Developer. You must have strong React, TypeScript and JavaScript skills. You need at least 2 years of experience building component libraries and design systems. Knowledge of REST APIs, Git and Tailwind CSS is required. You will work on accessibility and performance. A bachelor's degree in Computer Science is preferred. Experience with testing and CI is a plus.`)

  const created = await withAi("job match", () =>
    api.createMatch({ analysis, resumeId: firstId, jobDescription: description }),
  )
  const match = created ? api.toMatchResult(created, view) : null

  if (created) {
    // This is what the provider stores: the raw match, keyed to the browser's
    // own version id.
    localStore.updateWorkspace(userId, (previous) => ({ ...previous, matches: [created, ...previous.matches] }))
  }

  if (match) {
    check("a match came back", Boolean(match))
    check("overallScore is 0-100", match.overallScore >= 0 && match.overallScore <= 100, String(match.overallScore))
    check("match.status is absent (a truthy one hides the card)", !match.status, JSON.stringify(match.status))
    check("verdict is a non-empty string", typeof match.verdict === "string" && match.verdict.length > 0, match.verdict)
    check("matched is an array of { requirement }", Array.isArray(match.matched) && match.matched.every((row) => typeof row.requirement === "string"))
    check("missing is an array of { requirement }", Array.isArray(match.missing) && match.missing.every((row) => typeof row.requirement === "string"))
    check("extras is an array of { requirement }", Array.isArray(match.extras) && match.extras.every((row) => typeof row.requirement === "string"))
    check("matching skills carry evidence", match.matched.every((row) => typeof row.evidence === "string"))
    check("gaps carry an importance the card can badge", match.missing.every((row) => ["required", "preferred", "nice-to-have"].includes(row.importance)))
    check("the match has 6 weighted breakdown rows", match.scoreBreakdown.length === 6)
    check("the match points at the browser's own version id", match.resumeId === firstId, match.resumeId)
    check("extras exclude anything the posting mentioned", (() => {
      const mentioned = new Set([...match.matched, ...match.missing].map((row) => row.requirement.toLowerCase()))
      return match.extras.every((row) => !mentioned.has(row.requirement.toLowerCase()))
    })())
    check("extras come from the candidate's own skills", match.extras.length === 0 || view.allSkills.some((skill) => match.extras.some((extra) => extra.requirement === skill.name)))
  } else {
    skip("match shape assertions", "no match was produced")
  }

  section("Match history")
  await withAi("second match", () =>
    api.createMatch({ analysis, resumeId: firstId, jobDescription: `${description}\n\nSecond posting: Contract Design role.` }),
  )

  const history = workspace().matches
  check("the matches are in the history", history.length >= 1, `${history.length}`)
  check("each stored match carries a score and a title", history.every((row) => typeof row.score === "number" && typeof row.jobTitle === "string" && row.jobTitle.length > 0))
  check("stored matches carry the full breakdown", history.every((row) => (row.scoreBreakdown ?? []).length === 6))

  const rows = localStore.summariseMatches(workspace())
  check("the history projects without a request", rows.length === history.length)

  const opened = history[0] ? api.toMatchResult(history[0], view) : null
  check("a history row opens into a full match", Boolean(opened) && Array.isArray(opened.matched))

  section("Improve my CV")
  const improvements = await withAi("improve my CV", () => api.improveCv(analysis))
  if (improvements) {
    check("a rewritten summary came back", typeof improvements.improvedSummary === "string" && improvements.improvedSummary.length > 0)
    check("suggestions came back", Array.isArray(improvements.suggestions) && improvements.suggestions.length > 0, `${improvements.suggestions.length}`)
    check("a disclaimer is attached", typeof improvements.disclaimer === "string" && improvements.disclaimer.length > 0, improvements.disclaimer.slice(0, 48))

    // Written onto the stored analysis, exactly as the provider does.
    localStore.updateWorkspace(userId, (previous) => ({
      ...previous,
      resumes: previous.resumes.map((resume) =>
        resume.id === firstId ? { ...resume, analysis: { ...resume.analysis, improvements } } : resume,
      ),
    }))

    const improved = workspace().resumes.find((resume) => resume.id === firstId)
    const withImprovements = api.mapAnalysis(improved.analysis, improved)
    check("the suggestions are stored with the analysis", withImprovements.improvements?.improvedSummary === improvements.improvedSummary)
    check("and are read back after a reload", api.mapAnalysis(localStore.getWorkspace(userId).resumes.find((r) => r.id === firstId).analysis, improved).improvements?.suggestions.length === improvements.suggestions.length)
  } else {
    skip("improve assertions", "no suggestions were produced")
  }

  section("Comparison")
  const analysed = workspace().resumes.filter((resume) => resume.analysis).map((resume) => ({
    id: resume.id,
    label: resume.label,
    originalName: resume.originalName,
    createdAt: resume.createdAt,
    analysis: resume.analysis,
  }))

  if (analysed.length >= 2) {
    const comparison = await withAi("comparison", () => api.compareVersions(analysed))
    if (comparison) {
      check("both versions came back as columns", comparison.versions.length === 2)
      check("one row per metric plus overall", comparison.rows.length === 9, `${comparison.rows.length} rows`)
      check("every row has a value per version", comparison.rows.every((row) => row.values.length === 2))
      check("every row marks its leader", comparison.rows.every((row) => Array.isArray(row.best) && row.best.length === 2))
      check("a winning version is identified", Boolean(comparison.winner?.resumeId))
      check("columns carry the browser's own ids", comparison.versions.every((v) => analysed.some((a) => a.id === v.resumeId)))
    } else {
      skip("comparison assertions", "the request did not come back")
    }
  } else {
    skip("comparison assertions", "fewer than two analysed versions")
  }

  section("Renaming and deleting")
  localStore.updateWorkspace(userId, (previous) => ({
    ...previous,
    resumes: previous.resumes.map((resume) =>
      resume.id === secondId ? { ...resume, label: "Full Stack" } : resume,
    ),
  }))
  check("a version can be renamed locally", workspace().resumes.find((r) => r.id === secondId).label === "Full Stack")

  const beforeDelete = workspace().matches.length
  localStore.updateWorkspace(userId, (previous) => localStore.removeResume(previous, firstId))
  check("deleting a version removes it", workspace().resumes.length === 1)
  check("deleting a version removes its matches", workspace().matches.length < beforeDelete, `${beforeDelete} -> ${workspace().matches.length}`)

  section("Nothing was left on the server")
  check(
    "every uploaded file was deleted after parsing",
    (await countUploads()) === filesAtStart,
    `${filesAtStart} before, ${await countUploads()} after`,
  )

  // There is no server-side copy of a CV to fetch, so the endpoints that used to
  // serve one do not exist. A 404 is the proof that nothing can be requested back.
  for (const route of ["/resumes", "/jobs"]) {
    const response = await fetch(`${API_BASE_URL}${route}`, {
      headers: { Authorization: `Bearer ${api.getToken()}` },
    })
    check(`GET ${route} no longer exists`, response.status === 404, `status ${response.status}`)
  }

  /* ---------------------------------------------------------------- *
   * Account settings — what Settings.jsx calls
   * ---------------------------------------------------------------- */

  section("Account details (PATCH /auth/me)")
  {
    const newEmail = `client.renamed.${Date.now()}@example.com`

    const renamed = await api.updateProfile({ name: "Renamed Tester", email: newEmail })
    check("updateProfile hands back the new session", renamed.username === "Renamed Tester" && renamed.email === newEmail, `${renamed.username} <${renamed.email}>`)
    check("the sidebar initials follow the new name", renamed.initials === "RT", renamed.initials)
    check("the session carries nothing but id, name, email and initials", Object.keys(renamed).join(",") === "id,username,email,initials", Object.keys(renamed).join(","))
    check("the token is kept — the account was updated, not replaced", Boolean(api.getToken()))

    // Re-read rather than trusting the response: this is the write landing in
    // the database, which is the whole point of the settings page.
    const reread = await api.getMe()
    check("the new name is what the database returns", reread.username === "Renamed Tester", reread.username)
    check("the new email is what the database returns", reread.email === newEmail, reread.email)

    const reLogin = await api.login({ identifier: newEmail, password })
    check("the new email is the one that signs in", reLogin.email === newEmail, reLogin.email)
    check("the old email no longer signs in", (await api.login({ identifier: email, password }).then(() => null, (error) => error))?.status === 401)
    // A rejected sign-in drops the stored token, so the session is restored
    // before the next call rather than being left unauthenticated.
    await api.login({ identifier: newEmail, password })

    // The id the documents are keyed to must not have moved: a profile change
    // that orphaned them would look like data loss.
    check("the account id is unchanged, so the local data still resolves", reLogin.id === userId, `${reLogin.id}`)
    check("the documents survived the profile change", workspace().resumes.length === 1)

    accounts[0].email = newEmail
  }

  section("Password change (PATCH /auth/me/password)")
  {
    const rotated = "BrandNewPass456!"

    const tooShort = await api.changePassword({ currentPassword: password, newPassword: "short" }).then(() => null, (error) => error)
    check("a too-short new password is rejected on the field", tooShort?.status === 400 && /at least 8/i.test(tooShort?.details?.newPassword ?? ""), tooShort?.details?.newPassword)

    const wrong = await api.changePassword({ currentPassword: "not-the-password", newPassword: rotated }).then(() => null, (error) => error)
    check("the wrong current password is rejected", wrong?.status === 400 && wrong.message === "Your current password is not correct.", wrong.message)

    await api.changePassword({ currentPassword: password, newPassword: rotated })
    // No sign-in between these two: a password change must not end the session.
    check("the session survives the password change", (await api.getMe()).username === "Renamed Tester")
    check("the documents survived the password change", workspace().resumes.length === 1)

    const stale = await api.login({ identifier: accounts[0].email, password }).then(() => null, (error) => error)
    check("the old password no longer signs in", stale?.status === 401, stale?.message)
    const fresh = await api.login({ identifier: accounts[0].email, password: rotated })
    check("the new password signs in", fresh.email === accounts[0].email, fresh.email)

    accounts[0].password = rotated
  }

  section("Two accounts on one browser")
  {
    const otherEmail = `other.${Date.now()}@example.com`
    accounts.push({ email: otherEmail, password })

    const otherSession = await api.register({ username: "Other Person", email: otherEmail, password })
    const otherWorkspace = localStore.getWorkspace(otherSession.id)

    check("the other account sees none of the versions", otherWorkspace.resumes.length === 0, `${otherWorkspace.resumes.length}`)
    check("the other account sees none of the matches", otherWorkspace.matches.length === 0, `${otherWorkspace.matches.length}`)
    check("this account's versions are untouched by their sign-in", workspace().resumes.length === 1, `${workspace().resumes.length}`)

    // Signing back in must restore what was there, not what the last person left.
    await api.login({ identifier: accounts[0].email, password: accounts[0].password })
    check("signing back in restores this account's documents", localStore.getWorkspace(userId).resumes.length === 1)
    check("and still nothing of the other account's", localStore.getWorkspace(otherSession.id).resumes.length === 0)
  }

  section("Account deletion (DELETE /auth/me)")
  {
    await api.deleteAccount()
    check("the stored token is dropped with the account", api.getToken() === null)
    check("the account no longer signs in", (await api.login({ identifier: accounts[0].email, password: accounts[0].password }).then(() => null, (error) => error))?.status === 401)

    // The browser holds the only copy, so deleting the account has to take it.
    // `AuthContext.deleteAccount` is what does this; asserted here because the
    // promise the app makes is that nothing is left behind.
    localStore.clearWorkspace(userId)
    check("the browser's copy is gone with the account", localStore.getWorkspace(userId).resumes.length === 0)
    check("nothing is left on disk from this run", (await countUploads()) === filesAtStart, `${await countUploads()} file(s)`)

    accounts[0].deleted = true
  }
} catch (error) {
  if (error instanceof AiUnavailable) {
    skip("the analysis-driven journey", error.message)
  } else {
    // A throw here means the run aborted part-way, so the pass/fail tally below
    // is meaningless. Say what actually broke instead.
    failures.push("the run aborted")
    console.error(`\nthe run threw before it finished: ${error?.message ?? error}`)
    if (error?.details) console.error(`cause: ${JSON.stringify(error.details)}`)
    console.error(error?.stack)
  }
} finally {
  // Each account is removed through the API. The token in storage belongs to
  // whichever account was created last, and one of them has a new password now.
  console.log("")
  for (const account of accounts) {
    if (account.deleted) {
      console.log(`cleaned up ${account.email} during the run`)
      continue
    }

    try {
      await api.login({ identifier: account.email, password: account.password })
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      // Checked, not assumed: an unverified cleanup reports success while
      // quietly leaving the account behind.
      if (response.ok) {
        console.log(`cleaned up ${account.email}`)
      } else {
        console.log(`FAILED to clean up ${account.email} — status ${response.status}`)
        failures.push(`cleanup of ${account.email}`)
      }
    } catch (error) {
      console.log(`could not clean up ${account.email} — ${error?.message ?? error}`)
      failures.push(`cleanup of ${account.email}`)
    }
  }
  api.logout()
}

console.log(`\n${passed} client check(s) passed.`)

// Skips are reported, never folded into the pass count: an upstream model that
// refused a document is not the same as a verified behaviour, and pretending
// otherwise would let a real regression hide behind a flaky provider.
if (skips.length) {
  console.log(`${skips.length} step(s) skipped because the AI provider did not return a usable result:`)
  for (const entry of skips) console.log(`  - ${entry}`)
}

if (failures.length) {
  console.log(`${failures.length} FAILED:`)
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exitCode = 1
}