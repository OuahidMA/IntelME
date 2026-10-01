/**
 * Exercises the real client data layer against the running API.
 *
 * Lint and build prove the module parses; they say nothing about whether the
 * mappers produce the shapes the pages render. This drives `src/Services/api.js`
 * through the same journey a user does — sign up, upload, read, score, match,
 * improve, compare, clean up — and asserts the invariants the components depend
 * on, including the ones that would otherwise fail silently in the browser
 * (a null array turning into `Cannot read .length of null`, a `YYYY-MM` date
 * becoming `Invalid Date`, a `status` field hiding the match card).
 *
 * Usage: node scripts/checkClient.mjs   (with the server already listening)
 */

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(here, "../../server/uploads/__fixtures__")
const UPLOADS = path.resolve(here, "../../server/uploads")

/**
 * How many uploaded files are sitting on disk, fixtures aside.
 *
 * The files are the one part of an account that is not inside its document, so
 * counting them is the only way to see from here that deleting an account
 * unlinked its uploads.
 */
async function countUploads() {
  const entries = await readdir(UPLOADS, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isFile()).length
}

/* The module under test reaches for browser globals; provide the minimum. */
const store = new Map()
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
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
globalThis.document = {
  createElement: () => ({
    click() {},
    remove() {},
    set href(value) {
      this.href = value
    },
  }),
  body: { append() {} },
}
globalThis.URL.createObjectURL = () => "blob:stub"
globalThis.URL.revokeObjectURL = () => {}

const api = await import("../src/Services/api.js")

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

try {
  section("Auth")
  const session = await api.register({ username: "Client Tester", email, password })
  check("register returns a session", Boolean(session))
  check("session has initials for the sidebar", session.initials === "CT", session.initials)
  check("session username came from the name field", session.username === "Client Tester")
  check("a token was stored", Boolean(api.getToken()))

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
  const resumeId = uploaded.resume.id
  analysis = uploaded.analysis

  // The model sometimes declines to structure a document, and the provider can
  // also run out of quota. Both are real outcomes, and the product's answer is to
  // re-run the analysis on the version that was already saved — so the test uses
  // the same path a user would.
  if (analysis === null) {
    check("a failed analysis still returns the saved version", Boolean(resumeId), uploaded.reason)
    check("the caller is told it can retry", uploaded.canRetry === true)

    const recovered = await withAi("re-run after a failed analysis", () => api.reanalyse(resumeId))
    analysis = recovered?.analysis ?? null

    if (analysis) {
      check("re-running the analysis recovers the version", true, `score ${analysis.atsScore}`)
    }
  } else {
    check("an analysis came back on the first pass", true, `score ${analysis.atsScore}`)
  }

  if (!analysis) {
    // Every remaining section reads this analysis, so there is nothing left to
    // verify. Reported as an infrastructure skip, not a failure of this code.
    throw new AiUnavailable("the model never returned a structured result for the CV")
  }

  section("Analysis mapping (what Analysis.jsx and Dashboard.jsx read)")
  check("atsScore is a number in 0-100", typeof analysis.atsScore === "number" && analysis.atsScore >= 0 && analysis.atsScore <= 100, String(analysis.atsScore))
  check("fileName is a non-empty string", typeof analysis.fileName === "string" && analysis.fileName.length > 0, analysis.fileName)
  check("role is never null (it is .toLowerCase()d unguarded)", typeof analysis.role === "string", JSON.stringify(analysis.role))
  check("checks is a non-null array", Array.isArray(analysis.checks) && analysis.checks.length === 8, `${analysis.checks.length} rows`)
  check("every check has a label and a known status", analysis.checks.every((row) => row.label && ["pass", "warn", "fail"].includes(row.status)))
  check("suggestions is capped at 4 (the bar goes negative past that)", analysis.suggestions.length <= 4, `${analysis.suggestions.length} suggestions`)
  check("suggestions are plain strings", analysis.suggestions.every((row) => typeof row === "string"))
  check("recommendations survived the cap", analysis.recommendations.length > 0, `${analysis.recommendations.length}`)
  check("skills.matched is a non-null array", Array.isArray(analysis.skills.matched) && analysis.skills.matched.length > 0, `${analysis.skills.matched.length} skills`)
  check("skills.missing is a non-null array", Array.isArray(analysis.skills.missing))
  check("every matched skill has a label and a numeric confidence", analysis.skills.matched.every((skill) => skill.label && typeof skill.confidence === "number"))
  check("every matched skill has a category", analysis.skills.matched.every((skill) => Boolean(skill.category)))
  check("scoreBreakdown has 8 weighted rows", analysis.scoreBreakdown.length === 8)
  check("the earned values sum to the headline score", (() => {
    const total = analysis.scoreBreakdown.reduce((sum, row) => sum + row.earned, 0)
    return Math.abs(total - analysis.atsScore) < 1
  })())

  section("Experience timeline contract")
  check("experience is a non-null array", Array.isArray(analysis.experience))
  check("every role has a unique id (it is the React key)", (() => {
    const ids = analysis.experience.map((role) => role.id)
    return new Set(ids).size === ids.length && ids.every(Boolean)
  })(), `${analysis.experience.length} roles`)
  check("every start parses as a real date (YYYY-MM)", analysis.experience.every((role) => !Number.isNaN(new Date(`${role.start}-01T00:00:00`).getTime())), analysis.experience.map((r) => r.start).join(", "))
  check("every non-current end parses as a real date", analysis.experience.every((role) => role.current || !Number.isNaN(new Date(`${role.end}-01T00:00:00`).getTime())))
  check("months between start and end is a real number", analysis.experience.every((role) => Number.isFinite(Math.max(1, (new Date(`${role.end ?? new Date().toISOString().slice(0, 7)}-01T00:00:00`) - new Date(`${role.start}-01T00:00:00`)) / (1000 * 60 * 60 * 24 * 30.44)))))
  check("no role renders an 'Invalid Date' label", analysis.experience.every((role) => !String(role.start).includes("Invalid")))

  section("Versions")
  const docx = await readFile(path.join(FIXTURES, "john-doe-cv.docx"))
  const second = await api.uploadResume(
    new File([docx], "client-check.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    { label: "Second" },
  )

  // The AI call can fail on a document it cannot structure, and that is a real
  // outcome rather than a broken build. What matters is that the version still
  // exists and can be re-analysed in place — not that the user re-uploads it.
  if (second.analysis === null) {
    check("a failed analysis still returns the saved version", Boolean(second.resume?.id), second.reason)
    check("the caller is told it can retry", second.canRetry === true)

    const retried = await api.reanalyse(second.resume.id)
    check("re-running the analysis recovers the version", retried.analysis !== null, retried.analysis ? `score ${retried.analysis.atsScore}` : "still failing")
  } else {
    check("the second version analysed on the first pass", second.analysis.atsScore > 0, `score ${second.analysis.atsScore}`)
  }

  const versions = await api.listResumes()
  check("both versions are listed", versions.length === 2, `${versions.length}`)
  check("each version exposes the { name, size, type } the chip shows", versions.every((version) => version.name && "size" in version && version.type))
  check("the newest version is first", versions[0].label === "Second", versions[0].label)

  const analyses = await api.listAnalyses()
  check("every version has a score", analyses.length === 2 && analyses.every((row) => typeof row.score === "number"), `${analyses.length} analysed`)
  check("the analysis list carries the resume label for the cards", analyses.every((row) => Boolean(row.label)))

  section("Job match")
  description = await readFile(path.join(FIXTURES, "job.txt"), "utf8").catch(() => `We are hiring a Frontend Developer. You must have strong React, TypeScript and JavaScript skills. You need at least 2 years of experience building component libraries and design systems. Knowledge of REST APIs, Git and Tailwind CSS is required. You will work on accessibility and performance. A bachelor's degree in Computer Science is preferred. Experience with testing and CI is a plus.`
  )

  const created = await withAi("job match", () =>
    api.createMatch({ resumeId, jobDescription: description }),
  )
  const match = created ? api.toMatchResult(created, analysis) : null

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
    check("extras exclude anything the posting mentioned", (() => {
      const mentioned = new Set([...match.matched, ...match.missing].map((row) => row.requirement.toLowerCase()))
      return match.extras.every((row) => !mentioned.has(row.requirement.toLowerCase()))
    })())
    check("extras come from the candidate's own skills", match.extras.length === 0 || analysis.allSkills.some((skill) => match.extras.some((extra) => extra.requirement === skill.name)))
  } else {
    skip("match shape assertions", "no match was produced")
  }

  section("Match history")
  await withAi("second match", () =>
    api.createMatch({ resumeId, jobDescription: `${description}\n\nSecond posting: Contract Design role.` }),
  )

  const history = await api.listMatches()
  check("the matches are in the history", history.length >= 1, `${history.length}`)
  check("each history row has a score and a title", history.every((row) => typeof row.score === "number" && typeof row.jobTitle === "string" && row.jobTitle.length > 0))
  check("history rows expose the skill lists as plain strings", history.every((row) => row.matchingSkills.every((name) => typeof name === "string")))

  const sorted = await api.listMatches({ sort: "score:desc" })
  check("sorting by score works", sorted.length === 0 || sorted.every((row, index, all) => index === 0 || all[index - 1].score >= row.score), sorted.map((r) => r.score).join(" >= "))

  // Search covers the title and the company, not the body of the posting — the
  // description is not indexed, so a word that only appears in it is not a hit.
  const byTitle = await api.listMatches({ search: "Frontend" })
  check("searching a title finds its matches", byTitle.length > 0, `${byTitle.length} hit(s)`)
  const byBodyOnly = await api.listMatches({ search: "zzz-not-a-real-role" })
  check("a term in no title returns nothing", byBodyOnly.length === 0, `${byBodyOnly.length} hit(s)`)

  const highOnly = await api.listMatches({ min: 90 })
  check("the min filter drops matches below the threshold", highOnly.every((row) => row.score >= 90), highOnly.map((r) => r.score).join(", ") || "none above 90")

  const opened = await api.toMatchResult(await api.getMatch(history[0].id), analysis)
  check("a history row opens into a full match", opened.overallScore >= 0 && Array.isArray(opened.matched))

  section("Improve my CV")
  const improvements = await withAi("improve my CV", () => api.improveCv(resumeId))
  if (improvements) {
    check("a rewritten summary came back", typeof improvements.improvedSummary === "string" && improvements.improvedSummary.length > 0)
    check("suggestions came back", Array.isArray(improvements.suggestions) && improvements.suggestions.length > 0, `${improvements.suggestions.length}`)
    check("a disclaimer is attached", typeof improvements.disclaimer === "string" && improvements.disclaimer.length > 0, improvements.disclaimer.slice(0, 48))
  } else {
    skip("improve assertions", "no suggestions were produced")
  }

  section("Comparison")
  const ids = versions.map((version) => version.id)
  const comparison = await api.compareVersions(ids)
  check("both versions came back as columns", comparison.versions.length === 2)
  check("one row per metric plus overall", comparison.rows.length === 9, `${comparison.rows.length} rows`)
  check("every row has a value per version", comparison.rows.every((row) => row.values.length === 2))
  check("every row marks its leader", comparison.rows.every((row) => Array.isArray(row.best) && row.best.length === 2))
  check("a winning version is identified", Boolean(comparison.winner?.resumeId))

  section("Re-analysis and text")
  const refreshed = await withAi("re-analysis", () => api.reanalyse(resumeId))
  if (refreshed) {
    check("re-running the analysis returns a fresh score", typeof refreshed.analysis.atsScore === "number", String(refreshed.analysis.atsScore))
    check("the re-analysis is still a valid 8-row breakdown", refreshed.analysis.scoreBreakdown.length === 8)
  } else {
    skip("re-analysis assertions", "the model did not return a structured result")
  }

  const text = await api.getExtractedText(resumeId)
  check("the extracted text is readable", text.extractedText.length > 100, `${text.characters} chars`)

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

    // The data belongs to the account document, so changing a field on it must
    // not disturb anything else stored there.
    check("the resume survived the profile change", (await api.listResumes()).length === versions.length, `${versions.length}`)
    check("the match history survived the profile change", (await api.listMatches()).length === history.length, `${history.length}`)

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

    const stale = await api.login({ identifier: accounts[0].email, password }).then(() => null, (error) => error)
    check("the old password no longer signs in", stale?.status === 401, stale?.message)
    const fresh = await api.login({ identifier: accounts[0].email, password: rotated })
    check("the new password signs in", fresh.email === accounts[0].email, fresh.email)

    check("the resume survived the password change", (await api.listResumes()).length === versions.length)
    accounts[0].password = rotated
  }

  section("Authorisation")
  {
    const otherEmail = `other.${Date.now()}@example.com`
    accounts.push({ email: otherEmail, password })

    // Registering swaps the stored token, so from here on every call is made as
    // a different account and must be refused.
    await api.register({ username: "Other Person", email: otherEmail, password })

    const statusOf = (promise) => promise.then(() => null, (error) => error.status)

    check("another account cannot read this resume", (await statusOf(api.getResume(resumeId))) === 404)
    check("another account cannot open its analysis", (await statusOf(api.getAnalysis(resumeId))) === 404)
    check("another account cannot match it", (await statusOf(api.createMatch({ resumeId, jobDescription: description }))) === 404)
    check("another account cannot compare versions", (await statusOf(api.compareVersions(ids))) === 409)
    check("another account sees none of the versions", (await api.listResumes()).length === 0)
    check("another account sees none of the history", (await api.listMatches()).length === 0)
    check("another account cannot rename the version", (await statusOf(api.renameResume(resumeId, "Hijacked"))) === 404)
    check("another account cannot delete the version", (await statusOf(api.deleteResume(resumeId))) === 404)

    // The email is the identity, so taking one that is taken has to be refused
    // rather than quietly moving the other account's login to this one.
    const taken = await api.updateProfile({ email: accounts[0].email }).then(() => null, (error) => error)
    check("another account cannot claim an email that is already in use", taken?.status === 409, `status ${taken?.status}`)
    check("the refusal says which field is the problem", /email/i.test(taken?.details?.email ?? ""), taken?.details?.email)
    check("the other account's own email is unchanged after the attempt", (await api.getMe()).email === otherEmail)
  }

  section("Account deletion (DELETE /auth/me)")
  {
    // Back to the account that owns the data, so the cascade has something to
    // take with it.
    await api.login({ identifier: accounts[0].email, password: accounts[0].password })

    const owned = await api.listResumes()
    const ownedMatches = await api.listMatches()
    check("the account about to be deleted owns a resume", owned.length > 0, `${owned.length}`)
    check("the account about to be deleted owns job matches", ownedMatches.length > 0, `${ownedMatches.length}`)
    const filesBefore = await countUploads()

    await api.deleteAccount()

    check("the stored token is dropped with the account", api.getToken() === null)
    check("the account no longer signs in", (await api.login({ identifier: accounts[0].email, password: accounts[0].password }).then(() => null, (error) => error))?.status === 401)
    check("its uploaded files are unlinked", (await countUploads()) === filesBefore - owned.length, `${filesBefore} before, ${await countUploads()} after, ${owned.length} version(s)`)

    // Nothing is left to clean up for this account: the delete already removed
    // the document that held the resumes, the analyses and the matches.
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
  // The account owns its files, analyses and matches, and deleting the account
  // removes all three server-side. Log in as each in turn: the token in storage
  // belongs to whichever account was created last, and one of them has a new
  // password by now.
  console.log("")
  for (const account of accounts) {
    if (account.deleted) {
      console.log(`cleaned up ${account.email} during the run`)
      continue
    }

    try {
      await api.login({ identifier: account.email, password: account.password })
      const response = await fetch("http://localhost:5000/api/auth/me", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${api.getToken()}` },
      })
      // Checked, not assumed: an unverified cleanup reports success while
      // quietly leaving the account and its uploads behind.
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
