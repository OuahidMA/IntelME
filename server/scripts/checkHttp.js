/**
 * Full-stack HTTP check against a running server.
 *
 * Walks the product's real journey — sign up, log in, upload two CV versions,
 * read the analysis, improve the CV, match a job, page through the history,
 * compare versions, clean up — and asserts the security rules along the way:
 * the password is never echoed back, protected routes reject a missing or bogus
 * token, a wrong password says "Email or password incorrect", and no secret
 * from .env appears in any response body.
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

async function uploadFile(fileName, label, mime) {
  const bytes = await fs.readFile(path.join(FIXTURES, fileName));
  const form = new FormData();

  form.append("file", new Blob([bytes], { type: mime }), fileName);
  form.append("label", label);

  return call("POST", "/api/resumes", { form });
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
  ["GET", "/api/resumes"],
  ["GET", "/api/analysis"],
  ["GET", "/api/jobs"],
];

for (const [method, route] of protectedRoutes) {
  const response = await call(method, route, { auth: false });
  report(response.status === 401, `${method} ${route} requires a JWT`, `status ${response.status}`);
}

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
const rejected = await call("POST", "/api/resumes", { form: exeForm });
report(rejected.status === 400, "a .exe upload is rejected", `status ${rejected.status}`);

const bigForm = new FormData();
bigForm.append("file", new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: "application/pdf" }), "huge.pdf");
const tooBig = await call("POST", "/api/resumes", { form: bigForm });
report(tooBig.status === 400, "a 6 MB file is rejected (limit 5 MB)", `status ${tooBig.status}`);

const noFile = await call("POST", "/api/resumes", { form: new FormData() });
report(noFile.status === 400, "an upload with no file is rejected", `status ${noFile.status}`);

/* ---------------- real uploads ---------------- */

console.log("\nUploading (this calls the live AI, so it takes a moment)…\n");

// Taken before the first upload of this run. The directory is shared with real
// users, so "no uploads left" is not something this script may assert — the
// account it creates owns three files, and those are what has to disappear.
const uploadsAtStart = await countUploads();

const pdfUpload = await uploadFile("john-doe-cv.pdf", "Frontend", "application/pdf");
report(pdfUpload.status === 201, "upload .pdf -> analysed", `status ${pdfUpload.status} ${pdfUpload.data?.message ?? pdfUpload.data?.error ?? ""}`);

const resume1 = pdfUpload.data?.resume;
const analysis1 = pdfUpload.data?.analysis;

if (resume1) {
  report(resume1.fileType === "pdf", "stored fileType is pdf", resume1.fileType);
  report(resume1.originalName === "john-doe-cv.pdf", "stored originalName");
  report(resume1.status === "completed", "resume status is completed", resume1.status);
  report(resume1.extractionMethod === "text", "PDF used the text layer", resume1.extractionMethod);
  report(resume1.filePath === undefined, "the on-disk path is not serialised");
  report(String(resume1.fileUrl).includes(resume1.id), "fileUrl points at the authenticated route", resume1.fileUrl);
  report(resume1.label === "Frontend", "version label stored", resume1.label);
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
  report(analysis1.resume === resume1.id, "analysis points at the resume");
  report(analysis1.user === undefined, "analysis carries no owner field");
  report(analysis1.password === undefined, "analysis carries no credentials");
}

const docxUpload = await uploadFile("john-doe-cv.docx", "Full Stack", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
report(docxUpload.status === 201, "upload .docx -> analysed", `status ${docxUpload.status}`);
report(docxUpload.data?.resume?.fileType === "docx", "stored fileType is docx", docxUpload.data?.resume?.fileType);
report(docxUpload.data?.resume?.label === "Full Stack", "second version label stored", docxUpload.data?.resume?.label);

const ocrUpload = await uploadFile("scanned-cv.pdf", "Scanned", "application/pdf");
report(ocrUpload.status === 201, "upload a scanned .pdf -> analysed", `status ${ocrUpload.status}`);
report(
  ocrUpload.data?.resume?.extractionMethod === "ocr",
  "scanned PDF went through OCR",
  ocrUpload.data?.resume?.extractionMethod,
);
report(
  (ocrUpload.data?.analysis?.profile?.fullName?.length ?? 0) > 0,
  "OCR text was good enough to extract a profile",
  ocrUpload.data?.analysis?.profile?.fullName,
);

/* ---------------- resume CRUD ---------------- */

const list = await call("GET", "/api/resumes");
report(list.status === 200 && list.data?.count === 3, "GET /api/resumes lists 3 versions", `count=${list.data?.count}`);
report(
  list.data?.resumes?.every((r) => r.user === undefined) === true,
  "the listed versions carry no owner field",
);

const one = await call("GET", `/api/resumes/${resume1.id}`);
report(one.status === 200 && one.data?.analysis?.id === analysis1.id, "GET /api/resumes/:id includes the analysis");

const text = await call("GET", `/api/resumes/${resume1.id}/text`);
report(text.status === 200 && (text.data?.extractedText?.length ?? 0) > 200, "GET /api/resumes/:id/text returns the extracted text", `${text.data?.characters} chars`);

const renamed = await call("PATCH", `/api/resumes/${resume1.id}`, { body: { label: "Frontend 2026" } });
report(renamed.data?.resume?.label === "Frontend 2026", "PATCH /api/resumes/:id renames a version");

const download = await call("GET", `/api/resumes/${resume1.id}/file`, { raw: true });
report(download.status === 200, "GET /api/resumes/:id/file downloads the original", `status ${download.status}`);

/* cross-account isolation */
const otherAccount = { name: "Mallory", email: `other.${stamp}@example.com`, password: "anotherPass1" };
const otherRegistered = await call("POST", "/api/auth/register", { body: otherAccount, auth: false });
const ownToken = token;
token = otherRegistered.data.token;

const stolenRead = await call("GET", `/api/resumes/${resume1.id}`);
report(stolenRead.status === 404, "another account cannot read this resume", `status ${stolenRead.status}`);

const stolenDownload = await call("GET", `/api/resumes/${resume1.id}/file`);
report(stolenDownload.status === 404, "another account cannot download this resume", `status ${stolenDownload.status}`);

const stolenDelete = await call("DELETE", `/api/resumes/${resume1.id}`);
report(stolenDelete.status === 404, "another account cannot delete this resume", `status ${stolenDelete.status}`);

const stolenCompare = await call("POST", "/api/analysis/compare", { body: { resumeIds: [resume1.id, docxUpload.data.resume.id] } });
report(stolenCompare.status >= 400, "another account cannot compare these versions", `status ${stolenCompare.status}`);

token = ownToken;

/* ---------------- improve my CV ---------------- */

console.log("\nImproving CV…\n");

const improved = await call("POST", `/api/analysis/${resume1.id}/improve`);
report(improved.status === 200, "POST /api/analysis/:id/improve", `status ${improved.status} ${improved.data?.message ?? ""}`);
report((improved.data?.improvements?.improvedSummary?.length ?? 0) > 20, "an improved summary was written");
report(improved.data?.improvements?.suggestions?.length > 0, "suggestions were produced", `${improved.data?.improvements?.suggestions?.length}`);
report((improved.data?.improvements?.disclaimer?.length ?? 0) > 0, "a disclaimer is attached", improved.data?.improvements?.disclaimer?.slice(0, 60));

const refine = await call("POST", `/api/analysis/${resume1.id}`);
report(refine.status === 200, "POST /api/analysis/:id re-runs the analysis", `status ${refine.status}`);

const listAnalyses = await call("GET", "/api/analysis");
report(listAnalyses.data?.count >= 3, "GET /api/analysis lists every version", `count=${listAnalyses.data?.count}`);

/* ---------------- job match ---------------- */

console.log("\nMatching a job…\n");

const shortJob = await call("POST", "/api/jobs/match", { body: { resumeId: resume1.id, jobDescription: "too short" } });
report(shortJob.status === 400, "a too-short job description is rejected", `status ${shortJob.status}`);

const noResume = await call("POST", "/api/jobs/match", { body: { resumeId: "000000000000000000000000", jobDescription: JOB_DESCRIPTION } });
report(noResume.status === 404, "an unknown resumeId is 404", `status ${noResume.status}`);

const match = await call("POST", "/api/jobs/match", {
  body: { resumeId: resume1.id, jobDescription: JOB_DESCRIPTION, jobTitle: "Frontend Developer" },
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
  report(m.jobTitle === "Frontend Developer", "job title stored", m.jobTitle);
  report(m.resume === resume1.id, "match points at the resume");
  report(m.user === undefined, "match carries no owner field");
}

/* ---------------- history ---------------- */

const second = await call("POST", "/api/jobs/match", {
  body: { resumeId: docxUpload.data.resume.id, jobDescription: JOB_DESCRIPTION, jobTitle: "Full Stack Engineer", company: "Acme" },
});
report(second.status === 201, "a second match is stored for the history");

const history = await call("GET", "/api/jobs");
report(history.data?.count === 2, "GET /api/jobs returns both matches", `count=${history.data?.count}`);

const byScore = await call("GET", "/api/jobs?sort=score:desc");
const scores = byScore.data?.matches?.map((row) => row.score) ?? [];
report(
  scores.length === 2 && scores[0] >= scores[1],
  "GET /api/jobs?sort=score:desc orders correctly",
  scores.join(" >= "),
);

const byDateAsc = await call("GET", "/api/jobs?sort=date:asc");
report(byDateAsc.status === 200, "GET /api/jobs?sort=date:asc works");

const filtered = await call("GET", "/api/jobs?min=90");
report(
  (filtered.data?.matches ?? []).every((row) => row.score >= 90),
  "GET /api/jobs?min=90 filters by score",
  `count=${filtered.data?.count}`,
);

const searched = await call("GET", `/api/jobs?search=${encodeURIComponent("Full Stack")}`);
report(searched.data?.count === 1, "GET /api/jobs?search= filters by title", `count=${searched.data?.count}`);

const byResume = await call("GET", `/api/jobs?resumeId=${docxUpload.data.resume.id}`);
report(byResume.data?.count === 1, "GET /api/jobs?resumeId= filters by version");

const bogusSort = await call("GET", "/api/jobs?sort=$where:asc");
report(bogusSort.status === 200 && bogusSort.data?.sort?.createdAt !== undefined, "an unknown sort key falls back safely", JSON.stringify(bogusSort.data?.sort));

const oneMatch = await call("GET", `/api/jobs/${m.id}`);
report(oneMatch.status === 200 && oneMatch.data?.match?.scoreBreakdown?.length === 6, "GET /api/jobs/:id returns the full match");

const stolenMatch = await call("GET", `/api/jobs/${m.id}`, { auth: false });
report(stolenMatch.status === 401, "GET /api/jobs/:id requires a JWT");

/* ---------------- compare versions ---------------- */

const compare = await call("POST", "/api/analysis/compare", {
  body: { resumeIds: [resume1.id, docxUpload.data.resume.id, ocrUpload.data.resume.id] },
});
report(compare.status === 200, "POST /api/analysis/compare", `status ${compare.status}`);
report(compare.data?.versions?.length === 3, "three versions returned", `${compare.data?.versions?.length}`);
report(compare.data?.rows?.length >= 5, "comparison rows returned", `${compare.data?.rows?.length}`);

if (compare.data?.rows) {
  const overall = compare.data.rows.find((row) => row.metric === "overall");
  report(overall?.values?.length === 3, "each row has a value per version");
  report(compare.data.winner?.id !== undefined, "a winning version is identified", `${compare.data.winner?.label} (${compare.data.winner?.score})`);
  console.log("\n  version comparison");
  console.log(`    ${"metric".padEnd(16)}${compare.data.versions.map((v) => v.label.padStart(12)).join("")}`);
  for (const row of compare.data.rows) {
    console.log(`    ${row.label.padEnd(16)}${row.values.map((v) => String(Math.round(v)).padStart(12)).join("")}`);
  }
}

const oneVersion = await call("POST", "/api/analysis/compare", { body: { resumeIds: [resume1.id] } });
report(oneVersion.status === 400, "comparing a single version is rejected", `status ${oneVersion.status}`);

/* ---------------- secret hygiene ---------------- */

const secrets = [
  ["MONGODB_URI", process.env.MONGODB_URI],
  ["JWT_SECRET", process.env.JWT_SECRET],
  ["GROQ_API_KEY", process.env.GROQ_API_KEY],
];

const bodies = [registered.text, me.text, list.text, one.text, match.text, compare.text, health.text];

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

const deletedMatch = await call("DELETE", `/api/jobs/${m.id}`);
report(deletedMatch.status === 200, "DELETE /api/jobs/:id removes one match");

const afterDelete = await call("GET", "/api/jobs");
report(afterDelete.data?.count === 1, "history shrank after the delete", `count=${afterDelete.data?.count}`);

const cleared = await call("DELETE", "/api/jobs");
report(cleared.status === 200, "DELETE /api/jobs clears the history");

// The row is easy to delete; the file it points at is the part that leaks.
// `filePath` is `select: false` and stripped from responses, so the check is
// black-box: count what is actually sitting in the uploads directory.
const filesBefore = await countUploads();
const deletedResume = await call("DELETE", `/api/resumes/${ocrUpload.data.resume.id}`);
report(deletedResume.status === 200, "DELETE /api/resumes/:id removes a version");

const filesAfter = await countUploads();
report(
  filesAfter === filesBefore - 1,
  "deleting a version also unlinks its file from disk",
  `${filesBefore} files before, ${filesAfter} after`,
);

const goneAnalysis = await call("GET", `/api/analysis/${ocrUpload.data.resume.id}`);
report(goneAnalysis.status === 404, "the deleted version's analysis is gone", `status ${goneAnalysis.status}`);

const badObjectId = await call("GET", "/api/resumes/not-an-id");
report(badObjectId.status === 400, "a malformed id is 400, not 500", `status ${badObjectId.status}`);

const missingRoute = await call("GET", "/api/nope");
report(missingRoute.status === 404, "an unknown route is 404", `status ${missingRoute.status}`);

// Leave the database as we found it. One of the three files was already unlinked
// with its version above, so the account takes the remaining two with it — back
// to whatever the directory held before this run started.
const filesBeforeAccountDelete = await countUploads();
const deleted = await call("DELETE", "/api/auth/me");
report(deleted.status === 200, "DELETE /api/auth/me removes the account");

const filesAfterAccountDelete = await countUploads();
report(
  filesAfterAccountDelete === uploadsAtStart,
  "deleting the account unlinks every file it owned",
  `${filesAfterAccountDelete} file(s) left, was ${uploadsAtStart} before the run (${filesBeforeAccountDelete} before the delete)`,
);

const orphan = await call("GET", "/api/auth/me");
report(orphan.status === 401, "the token is dead once the account is gone", `status ${orphan.status}`);

console.log(failures === 0 ? "\nAll HTTP checks passed." : `\n${failures} HTTP check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
