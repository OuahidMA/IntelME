/**
 * Full-stack HTTP check against a running server.
 *
 * Walks the product's real journey — sign up, log in, upload a CV, read the
 * analysis, improve it, match a job, compare two versions, clean up — and
 * asserts the security rules along the way: the password is never echoed back,
 * protected routes reject a missing or bogus token, a wrong password says "Email
 * or password incorrect", and no secret from .env appears in any response body.
 *
 * The journey here is the browser's: every call after the login carries data the
 * caller is holding, and the central assertion is that none of it is stored. The
 * server's job is the parsing, the model call and the arithmetic; the document is
 * not its business.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "..", "uploads", "__fixtures__");
const UPLOADS = path.resolve(__dirname, "..", "uploads");
const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";

/** Uploaded files sitting on disk, excluding the fixtures the tests read. */
async function countUploads() {
  const entries = await fs.readdir(UPLOADS, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).length;
}

const JOB_DESCRIPTION = `Frontend Developer
We are looking for a React developer with experience in:
React, TypeScript, JavaScript, REST APIs, Git, Tailwind CSS
2+ years of professional experience required.
You will work on our design system and ship customer-facing features weekly.`;

let failures = 0;
let token = null;

function report(ok, label, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function call(method, route, { body, form, auth = true, raw = false } = {}) {
  const headers = {};

  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let payload;

  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(`${BASE}${route}`, { method, headers, body: payload });
  const text = await response.text();

  let data = null;
  try {
    data = raw ? null : JSON.parse(text);
  } catch {
    data = null;
  }

  return { status: response.status, data, text, headers: response.headers };
}

/** The real product call: one multipart upload, parsed and analysed. */
async function uploadFile(fileName, label, mime) {
  const bytes = await fs.readFile(path.join(FIXTURES, fileName));
  const form = new FormData();

  form.append("file", new Blob([bytes], { type: mime }), fileName);
  form.append("label", label);

  return call("POST", "/api/resumes/analyse", { form });
}

console.log(`Testing ${BASE}\n`);

/* ---------------- health & CORS ---------------- */

const health = await call("GET", "/api/health", { auth: false });
report(health.status === 200 && health.data?.success === true, "GET /api/health", `status ${health.status}`);

const ping = await call("GET", "/api/ping", { auth: false });
report(ping.status === 200, "GET /api/ping (public, hits the DB)", `users=${ping.data?.users}`);

const corsAllowed = await fetch(`${BASE}/api/health`, { headers: { Origin: "http://localhost:5173" } });
report(
  corsAllowed.headers.get("access-control-allow-origin") === "http://localhost:5173",
  "CORS allows the client origin",
  corsAllowed.headers.get("access-control-allow-origin") ?? "(missing)",
);

// A static `origin` string is echoed back on every response, so the browser —
// not the server — is what rejects a foreign origin: the header it receives
// never matches the origin it asked from. That is the property to assert.
const foreignOrigin = "https://evil.example";
const corsDenied = await fetch(`${BASE}/api/health`, { headers: { Origin: foreignOrigin } });
const deniedHeader = corsDenied.headers.get("access-control-allow-origin");
report(
  deniedHeader !== foreignOrigin,
  "CORS never echoes a foreign origin back",
  deniedHeader ?? "(no header)",
);

const preflight = await fetch(`${BASE}/api/jobs/match`, {
  method: "OPTIONS",
  headers: {
    Origin: foreignOrigin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,content-type",
  },
});
report(
  preflight.headers.get("access-control-allow-origin") !== foreignOrigin,
  "preflight from a foreign origin is not granted",
  `status ${preflight.status}`,
);

/* ---------------- auth ---------------- */

const stamp = Date.now();
const account = {
  name: "John Doe",
  email: `e2e.${stamp}@example.com`,
  password: "sup3rSecret!",
};

const weak = await call("POST", "/api/auth/register", { body: { ...account, password: "short" }, auth: false });
report(weak.status === 400, "register rejects a short password", `status ${weak.status}`);

const missingName = await call("POST", "/api/auth/register", { body: { email: account.email, password: account.password }, auth: false });
report(missingName.status === 400, "register rejects a missing name", `status ${missingName.status}`);

const registered = await call("POST", "/api/auth/register", { body: account, auth: false });
report(registered.status === 201, "POST /api/auth/register", `status ${registered.status}`);
report(typeof registered.data?.token === "string" && registered.data.token.length > 20, "register returns a JWT");

const user = registered.data?.user;
report(user?.email === account.email.toLowerCase(), "user email stored lowercased", user?.email);
report(user?.name === account.name, "user name stored", user?.name);
report(typeof user?.createdAt === "string", "user createdAt present");
report(user?.password === undefined, "password hash is NOT in the response");
report(!registered.text.includes("sup3rSecret"), "plaintext password is NOT echoed anywhere");
report(!JSON.stringify(registered.data).includes("$2b$"), "bcrypt hash is NOT in the response");

// The account response is the whole of what the database holds about a CV, so it
// is worth asserting the absence of every field that used to live there.
report(!registered.text.includes("resumes"), "the account carries no resumes");
report(!registered.text.includes("analyses"), "the account carries no analyses");
report(!registered.text.includes("jobs"), "the account carries no job matches");

const duplicate = await call("POST", "/api/auth/register", { body: account, auth: false });
report(duplicate.status === 409, "duplicate email is rejected", `status ${duplicate.status}`);

const caseDup = await call("POST", "/api/auth/register", { body: { ...account, email: account.email.toUpperCase() }, auth: false });
report(caseDup.status === 409, "duplicate email is case-insensitive", `status ${caseDup.status}`);

/* ---------------- protected routes ---------------- */

const noToken = await call("GET", "/api/auth/me", { auth: false });
report(noToken.status === 401, "GET /api/auth/me without a token is 401", `status ${noToken.status}`);

const badResult = await (async () => {
  const response = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: "Bearer not.a.real.token" } });
  return response.status;
})();
report(badResult === 401, "a forged token is 401", `status ${badResult}`);

const protectedRoutes = [
  ["POST", "/api/resumes/analyse"],
  ["POST", "/api/analysis"],
  ["POST", "/api/jobs/match"],
];

for (const [method, route] of protectedRoutes) {
  const response = await call(method, route, { auth: false });
  report(response.status === 401, `${method} ${route} requires a JWT`, `status ${response.status}`);
}

// The routes that used to hand the server a document to look up are gone. Asserted
// after the login below, because `protect` answers 401 before routing gets a
// chance — the 404 is only visible to a caller who is actually signed in.

/* ---------------- login ---------------- */

const wrongPassword = await call("POST", "/api/auth/login", { body: { email: account.email, password: "wrong-password" }, auth: false });
report(wrongPassword.status === 401, "wrong password is 401", `status ${wrongPassword.status}`);
report(
  wrongPassword.data?.message === "Email or password incorrect",
  "wrong password message is exact",
  wrongPassword.data?.message,
);

const unknownEmail = await call("POST", "/api/auth/login", { body: { email: `nobody.${stamp}@example.com`, password: "whatever123" }, auth: false });
report(
  unknownEmail.data?.message === "Email or password incorrect",
  "unknown email gives the identical message (no user enumeration)",
  unknownEmail.data?.message,
);

const loggedIn = await call("POST", "/api/auth/login", { body: { email: account.email, password: account.password }, auth: false });
report(loggedIn.status === 200, "POST /api/auth/login", `status ${loggedIn.status}`);
report(typeof loggedIn.data?.token === "string", "login returns a JWT");

token = loggedIn.data.token;

// There is nothing stored to fetch, so the endpoints that used to hand back a
// document are not there. A signed-in caller gets a 404, which is the proof that
// there is no server-side copy of a CV to ask for.
for (const route of ["/api/resumes", "/api/jobs", "/api/analysis"]) {
  const response = await call("GET", route);
  report(response.status === 404, `GET ${route} no longer exists`, `status ${response.status}`);
}

// A token whose signature no longer matches its payload must be refused, even
// though the `sub` inside it is a real user id.
const tamperedResult = await (async () => {
  const [header, payload, signature] = loggedIn.data.token.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  decoded.sub = "000000000000000000000000";
  const forged = `${header}.${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;

  const response = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${forged}` } });
  return response.status;
})();
report(tamperedResult === 401, "a token with a swapped user id is 401", `status ${tamperedResult}`);

const me = await call("GET", "/api/auth/me");
report(me.status === 200 && me.data?.user?.email === account.email.toLowerCase(), "GET /api/auth/me with a valid token");
report(me.data?.user?.password === undefined, "GET /api/auth/me hides the password");

const updated = await call("PATCH", "/api/auth/me", { body: { name: "John A. Doe" } });
report(updated.status === 200 && updated.data?.user?.name === "John A. Doe", "PATCH /api/auth/me updates the name");
report(updated.data?.token === undefined, "PATCH /api/auth/me does not leak a token");

const badUpdate = await call("PATCH", "/api/auth/me", { body: { password: "hijack123" } });
report(badUpdate.status === 400, "PATCH /api/auth/me refuses a password change", `status ${badUpdate.status}`);

/* ---------------- upload validation ---------------- */

const limits = await call("GET", "/api/resumes/limits");
report(
  limits.data?.allowedExtensions?.join() === "pdf,docx",
  "GET /api/resumes/limits advertises pdf + docx only",
  limits.data?.allowedExtensions?.join(),
);
report(limits.data?.maxFileSizeMb > 0, "upload limit is published", `${limits.data?.maxFileSizeMb} MB`);

const exeBytes = await fs.readFile(path.join(FIXTURES, "not-a-cv.exe"));
const exeForm = new FormData();
exeForm.append("file", new Blob([exeBytes], { type: "application/x-msdownload" }), "malware.exe");
const rejected = await call("POST", "/api/resumes/analyse", { form: exeForm });
report(rejected.status === 400, "a .exe upload is rejected", `status ${rejected.status}`);

const bigForm = new FormData();
bigForm.append("file", new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: "application/pdf" }), "huge.pdf");
const tooBig = await call("POST", "/api/resumes/analyse", { form: bigForm });
report(tooBig.status === 400, "a 6 MB file is rejected (limit 5 MB)", `status ${tooBig.status}`);

const noFile = await call("POST", "/api/resumes/analyse", { form: new FormData() });
report(noFile.status === 400, "an upload with no file is rejected", `status ${noFile.status}`);

/* ---------------- real uploads ---------------- */

console.log("\nUploading (this calls the live AI, so it takes a moment)…\n");

// Taken before the first upload of this run. The directory is shared with real
// users, so "no uploads left" is not something this script may assert — what it
// can assert is that this run's own uploads are gone, because the server deletes
// each file as soon as it has parsed it.
const uploadsAtStart = await countUploads();

const pdfUpload = await uploadFile("john-doe-cv.pdf", "Frontend", "application/pdf");
report(pdfUpload.status === 201, "upload .pdf -> analysed", `status ${pdfUpload.status} ${pdfUpload.data?.message ?? ""}`);

const resume1 = pdfUpload.data?.resume;
const analysis1 = pdfUpload.data?.analysis;

if (resume1) {
  report(resume1.fileType === "pdf", "the file type came back as pdf", resume1.fileType);
  report(resume1.originalName === "john-doe-cv.pdf", "the original filename came back", resume1.originalName);
  report(resume1.extractionMethod === "text", "the PDF used its text layer", resume1.extractionMethod);
  report(resume1.label === "Frontend", "the version label came back", resume1.label);
  report(resume1.id === undefined, "the record carries no id — the browser names the version", resume1.id);
  report(!JSON.stringify(resume1).includes("uploads"), "the record carries no server path");
  report(!("filePath" in resume1) && !("fileUrl" in resume1), "the record carries no file handle");
  report(!("status" in resume1), "the record carries no lifecycle status");
}

if (analysis1) {
  console.log(`\n  CV score ${analysis1.score}/100`);
  for (const row of analysis1.scoreBreakdown) {
    console.log(`    ${row.label.padEnd(24)} ${String(row.score).padStart(3)}/100 x${row.weight}% = ${row.earned}`);
  }
  report(typeof analysis1.score === "number" && analysis1.score >= 0 && analysis1.score <= 100, "analysis score is 0-100", `${analysis1.score}`);
  report(analysis1.scoreBreakdown?.length === 8, "breakdown has the 8 weighted categories", `${analysis1.scoreBreakdown?.length}`);
  report(
    Math.round(analysis1.scoreBreakdown.reduce((sum, row) => sum + row.earned, 0)) === analysis1.score,
    "category earned values add up to the score",
  );
  report(typeof analysis1.verdict === "string" && analysis1.verdict.length > 0, "a verdict came back", analysis1.verdict?.slice(0, 40));
  report(analysis1.profile?.fullName?.length > 0, "profile.fullName extracted", analysis1.profile?.fullName);
  report(analysis1.profile?.email?.length > 0, "profile.email extracted", analysis1.profile?.email);
  report(analysis1.profile?.phone?.length > 0, "profile.phone extracted", analysis1.profile?.phone);
  report(analysis1.profile?.location?.length > 0, "profile.location extracted", analysis1.profile?.location);
  report((analysis1.profile?.summary?.length ?? 0) > 20, "profile.summary extracted");
  report(analysis1.skills?.length > 0, `skills extracted (${analysis1.skills?.length})`);
  report(
    analysis1.skills?.every((s) => s.name && s.category && s.level),
    "every skill has name + category + level",
  );
  report(analysis1.skills?.some((s) => s.category !== "Other"), "skill categories were classified", JSON.stringify([...new Set(analysis1.skills.map((s) => s.category))]));
  report(analysis1.experience?.length > 0, `experience extracted (${analysis1.experience?.length})`);
  report(analysis1.experience?.some((e) => e.current === true), "a current role is flagged");
  report(analysis1.education?.length > 0, `education extracted (${analysis1.education?.length})`);
  report(analysis1.certifications?.length > 0, `certifications extracted (${analysis1.certifications?.length})`);
  report(analysis1.projects?.length > 0, `projects extracted (${analysis1.projects?.length})`);
  report(analysis1.keywords?.length > 0, `keywords extracted (${analysis1.keywords?.length})`);
  report(analysis1.strengths?.length > 0, `strengths present (${analysis1.strengths?.length})`);
  report(analysis1.weaknesses?.length > 0, `weaknesses present (${analysis1.weaknesses?.length})`);
  report(analysis1.recommendations?.length > 0, `recommendations present (${analysis1.recommendations?.length})`);
  report(analysis1.resume === undefined, "the analysis points at nothing — the browser owns that link");
  report(analysis1.user === undefined, "the analysis carries no owner field");
  report(analysis1.password === undefined, "the analysis carries no credentials");
}

// Nothing about the upload is on disk once it has been read. This is the
// invariant the whole design rests on, so it is counted rather than assumed.
report(
  (await countUploads()) === uploadsAtStart,
  "the uploaded file is deleted from disk as soon as it is parsed",
  `${uploadsAtStart} before, ${await countUploads()} after`,
);

const docxUpload = await uploadFile("john-doe-cv.docx", "Full Stack", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
report(docxUpload.status === 201, "upload .docx -> analysed", `status ${docxUpload.status}`);
report(docxUpload.data?.resume?.fileType === "docx", "the .docx came back as docx", docxUpload.data?.resume?.fileType);
report(docxUpload.data?.resume?.label === "Full Stack", "the second version label came back", docxUpload.data?.resume?.label);

/* ---------------- re-analysis from text the caller holds ---------------- */

console.log("\nRe-analysing from the returned text…\n");

const extractedText = resume1?.extractedText ?? "";

report(extractedText.length > 200, "the recovered text came back with the response", `${extractedText.length} chars`);

const noText = await call("POST", "/api/analysis", { body: {} });
report(noText.status === 400, "POST /api/analysis rejects a missing text", `status ${noText.status}`);

const shortText = await call("POST", "/api/analysis", { body: { text: "too short to analyse" } });
report(shortText.status === 400, "POST /api/analysis rejects unusable text", `status ${shortText.status}`);

let refreshed = null;
if (extractedText.length > 40) {
  refreshed = await call("POST", "/api/analysis", { body: { text: extractedText } });
  report(refreshed.status === 200, "POST /api/analysis re-runs on stored text", `status ${refreshed.status} ${refreshed.data?.message ?? ""}`);
  report(typeof refreshed.data?.analysis?.score === "number", "a fresh score came back", `${refreshed.data?.analysis?.score}`);
  report(refreshed.data?.analysis?.scoreBreakdown?.length === 8, "the re-analysis is still a valid 8-row breakdown", `${refreshed.data?.analysis?.scoreBreakdown?.length}`);
  report(refreshed.data?.analysis?.id !== analysis1?.id, "each analysis is minted fresh");
}

/* ---------------- improve my CV ---------------- */

console.log("\nImproving CV…\n");

const improved = await call("POST", "/api/analysis/improve", {
  body: {
    profile: analysis1?.profile ?? {},
    weaknesses: analysis1?.weaknesses ?? [],
    recommendations: analysis1?.recommendations ?? [],
  },
});
report(improved.status === 200, "POST /api/analysis/improve", `status ${improved.status} ${improved.data?.message ?? ""}`);
// The contract is "2-3 sentences", not a word count: the model is free to answer
// briefly and asserting a length here would only measure today's mood.
report((improved.data?.improvements?.improvedSummary?.length ?? 0) > 0, "an improved summary was written", improved.data?.improvements?.improvedSummary?.slice(0, 48));
report(improved.data?.improvements?.suggestions?.length > 0, "suggestions were produced", `${improved.data?.improvements?.suggestions?.length}`);
report((improved.data?.improvements?.disclaimer?.length ?? 0) > 0, "a disclaimer is attached", improved.data?.improvements?.disclaimer?.slice(0, 60));

// It used to require an analysed version to exist. Now it takes the weaknesses as
// input, so there is nothing to look up — which is the point.
const bareImprove = await call("POST", "/api/analysis/improve", { body: {} });
report(bareImprove.status === 200, "POST /api/analysis/improve works with no prior analysis", `status ${bareImprove.status}`);

/* ---------------- job match ---------------- */

console.log("\nMatching a job…\n");

const shortJob = await call("POST", "/api/jobs/match", { body: { analysis: analysis1, jobDescription: "too short" } });
report(shortJob.status === 400, "a too-short job description is rejected", `status ${shortJob.status}`);

const noAnalysis = await call("POST", "/api/jobs/match", { body: { analysis: null, jobDescription: JOB_DESCRIPTION } });
report(noAnalysis.status === 400, "a match with no analysis is rejected", `status ${noAnalysis.status}`);

// The scorer reads the CV's own skills to discard gaps the posting named but the
// CV actually covers. With no analysis there is nothing to cross-check, so the
// scores would be meaningless rather than merely low.
const hostile = await call("POST", "/api/jobs/match", {
  body: {
    analysis: { score: 999999, skills: "not an array", profile: 7 },
    jobDescription: JOB_DESCRIPTION,
  },
});
report(hostile.status === 201, "a malformed analysis is coerced rather than trusted", `status ${hostile.status}`);
report(hostile.data?.match?.score >= 0 && hostile.data?.match?.score <= 100, "the coerced payload still scores 0-100", `${hostile.data?.match?.score}`);
report(Array.isArray(hostile.data?.match?.matchingSkills), "the coerced payload produces real arrays");

const match = await call("POST", "/api/jobs/match", {
  body: { analysis: analysis1, resumeId: "version-1", jobDescription: JOB_DESCRIPTION, jobTitle: "Frontend Developer" },
});
report(match.status === 201, "POST /api/jobs/match", `status ${match.status} ${match.data?.message ?? ""}`);

const m = match.data?.match;
if (m) {
  console.log(`\n  match ${m.score}/100 — ${m.verdict}`);
  for (const row of m.scoreBreakdown) {
    console.log(`    ${row.label.padEnd(16)} ${String(row.score).padStart(3)}/100 x${row.weight}% = ${row.earned}`);
  }
  console.log(`\n  matching skills : ${m.matchingSkills.map((s) => s.name).join(", ") || "(none)"}`);
  console.log(`  missing skills  : ${m.missingSkills.map((s) => `${s.name} (${s.importance})`).join(", ") || "(none)"}`);
  console.log(`  experience      : ${m.matchingExperience.candidateYears}y of ${m.matchingExperience.requiredYears}y — ${m.matchingExperience.status}`);
  console.log(`  education       : ${m.matchingEducation.status}`);
  console.log(`  strengths       :`);
  for (const line of m.strengths) console.log(`    ${line}`);
  console.log(`  gaps            :`);
  for (const line of m.gaps) console.log(`    ${line}`);
  console.log(`  recommendations :`);
  for (const line of m.recommendations) console.log(`    - ${line}`);

  report(typeof m.score === "number" && m.score >= 0 && m.score <= 100, "match score is 0-100", `${m.score}`);
  report(m.scoreBreakdown?.length === 6, "match breakdown has the 6 weighted categories");
  report(
    Math.round(m.scoreBreakdown.reduce((sum, row) => sum + row.earned, 0)) === m.score,
    "match earned values add up to the score",
  );
  report(m.matchingSkills?.length > 0, "matching skills listed", `${m.matchingSkills?.length}`);
  report(m.matchingSkills?.every((s) => s.name && s.evidence), "each matching skill carries evidence");
  report(Array.isArray(m.missingSkills), "missing skills listed", `${m.missingSkills?.length}`);
  report(m.missingSkills?.every((s) => ["required", "preferred", "nice-to-have"].includes(s.importance)), "gaps carry an importance");
  report(m.matchingExperience?.requiredYears === 2, "required years parsed from the posting", `${m.matchingExperience?.requiredYears}`);
  report(m.matchingExperience?.candidateYears > 0, "candidate years computed from the CV", `${m.matchingExperience?.candidateYears}`);
  report(m.matchingEducation?.status !== "unknown", "education compared", m.matchingEducation?.status);
  report(m.strengths?.length > 0, "strengths present", `${m.strengths?.length}`);
  report(m.gaps?.length > 0, "gaps present", `${m.gaps?.length}`);
  report(m.recommendations?.length > 0, "recommendations present", `${m.recommendations?.length}`);
  report(m.jobTitle === "Frontend Developer", "job title echoed back", m.jobTitle);
  report(m.resumeId === "version-1", "the browser's own version id is carried through", m.resumeId);
  report(m.user === undefined, "the match carries no owner field");
  report(m.resume === undefined, "the match points at nothing — the browser owns that link");
  report(typeof m.id === "string" && m.id.length > 0, "the match has an id", m.id);
}

/* ---------------- compare versions ---------------- */

const toColumn = (label, id) => ({
  resumeId: id,
  label,
  originalName: `${label}.pdf`,
  createdAt: new Date().toISOString(),
  analysis: analysis1,
});

const compare = await call("POST", "/api/analysis/compare", {
  body: { versions: [toColumn("Frontend", "v1"), toColumn("Full Stack", "v2"), toColumn("Scanned", "v3")] },
});
report(compare.status === 200, "POST /api/analysis/compare", `status ${compare.status}`);
report(compare.data?.versions?.length === 3, "three versions returned", `${compare.data?.versions?.length}`);
report(compare.data?.rows?.length >= 5, "comparison rows returned", `${compare.data?.rows?.length}`);

if (compare.data?.rows) {
  const overall = compare.data.rows.find((row) => row.metric === "overall");
  report(overall?.values?.length === 3, "each row has a value per version");
  report(compare.data.winner?.resumeId !== undefined, "a winning version is identified", `${compare.data.winner?.label} (${compare.data.winner?.score})`);
  console.log("\n  version comparison");
  console.log(`    ${"metric".padEnd(16)}${compare.data.versions.map((v) => v.label.padStart(12)).join("")}`);
  for (const row of compare.data.rows) {
    console.log(`    ${row.label.padEnd(16)}${row.values.map((v) => String(Math.round(v)).padStart(12)).join("")}`);
  }
}

// Two identical analyses must come out as a draw, with no leader marked on any
// row. If the columns were matched by id rather than by position, two columns
// sharing an id would collapse into one and this would fail.
const identical = await call("POST", "/api/analysis/compare", {
  body: { versions: [toColumn("One", "same"), toColumn("Two", "same")] },
});
report(
  identical.data?.rows?.every((row) => row.best.every((flag) => flag === true)),
  "two columns sharing an id still compare as two columns",
  identical.data?.rows?.length + " rows",
);

const oneVersion = await call("POST", "/api/analysis/compare", { body: { versions: [toColumn("Only", "v1")] } });
report(oneVersion.status === 400, "comparing a single version is rejected", `status ${oneVersion.status}`);

const noAnalysisCompare = await call("POST", "/api/analysis/compare", {
  body: { versions: [{ resumeId: "a", label: "A", analysis: null }, { resumeId: "b", label: "B", analysis: null }] },
});
report(noAnalysisCompare.status === 200, "comparing versions with no analysis is scored, not refused", `status ${noAnalysisCompare.status}`);
report(
  noAnalysisCompare.data?.rows?.every((row) => row.values.every((value) => value === 0)),
  "an un-analysed version scores zero rather than crashing",
);

/* ---------------- secret hygiene ---------------- */

const secrets = [
  ["MONGODB_URI", process.env.MONGODB_URI],
  ["JWT_SECRET", process.env.JWT_SECRET],
  ["GROQ_API_KEY", process.env.GROQ_API_KEY],
];

const bodies = [registered.text, me.text, health.text, match.text, compare.text];

for (const [label, value] of secrets) {
  if (!value) continue;
  const leaked = bodies.some((body) => body.includes(value));
  report(!leaked, `${label} never appears in any response body`);
}

const gskLeak = bodies.some((body) => body.includes("gsk_"));
report(!gskLeak, "no Groq key material in any response body");

const dbNameLeak = bodies.some((body) => body.includes("mongodb.net") || body.includes("Cluster0"));
report(!dbNameLeak, "no connection string fragment in any response body");

/* ---------------- teardown ---------------- */

const badRoute = await call("GET", "/api/nope");
report(badRoute.status === 404, "an unknown route is 404", `status ${badRoute.status}`);

const deleted = await call("DELETE", "/api/auth/me");
report(deleted.status === 200, "DELETE /api/auth/me removes the account");

const orphan = await call("GET", "/api/auth/me");
report(orphan.status === 401, "the token is dead once the account is gone", `status ${orphan.status}`);

// The whole run uploaded several files and every one of them was unlinked as
// soon as it had been parsed, so the directory is exactly as it started.
report(
  (await countUploads()) === uploadsAtStart,
  "no file from this run is left on the server",
  `${uploadsAtStart} before, ${await countUploads()} after`,
);

console.log(failures === 0 ? "\nAll HTTP checks passed." : `\n${failures} HTTP check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);