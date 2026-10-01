/**
 * Proves that an account created through the API is really a document in the
 * `users` collection of the `intelme` database, that everything belonging to it
 * lives inside that one document, and that every CRUD operation lands there.
 *
 * This reads the raw driver rather than the Mongoose model on purpose: the
 * question is what MongoDB actually holds, not what the app believes it holds.
 * Each step prints the stored document so the effect of the write is visible.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import mongoose from "mongoose";

import User from "../models/User.js";
import { UPLOAD_DIR } from "../middleware/uploadMiddleware.js";

const BASE = "http://localhost:5000/api";
const password = "CrudCheck123!";

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function api(route, { method = "GET", body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  return { status: response.status, data: await response.json().catch(() => ({})) };
}

/** The raw document, straight from the driver, bypassing every schema layer. */
const raw = (db) => (email) => db.collection("users").findOne({ email });

/** What MongoDB actually holds in this database — should only ever be `users`. */
const collectionNames = async () => (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
const db = mongoose.connection.db;

console.log("Target");
console.log(`  database           : ${db.databaseName}`);
console.log(`  model collection   : ${User.collection.name}`);
check("the database is intelme", db.databaseName === "intelme", db.databaseName);
check("the User model maps to the users collection", User.collection.name === "users", User.collection.name);
check("users is the only collection", (await collectionNames()).join(", ") === "users", (await collectionNames()).join(", "));

const email = `crud.${Date.now()}@example.com`;
const find = raw(db);

// Captured before anything is written, so the final count proves this run left
// the collection exactly as it found it.
const baseline = await db.collection("users").countDocuments();

console.log("\nCREATE — POST /api/auth/register");
const created = await api("/auth/register", {
  method: "POST",
  body: { name: "Crud Tester", email, password },
});
check("the account is created", created.status === 201, `status ${created.status}`);

let doc = await find(email.toLowerCase());
check("a document exists in intelme.users", Boolean(doc));
check("it holds the name", doc?.name === "Crud Tester", doc?.name);
check("it holds the email, lowercased", doc?.email === email.toLowerCase(), doc?.email);
check("it has an _id", Boolean(doc?._id), String(doc?._id));
check("it has a createdAt timestamp", doc?.createdAt instanceof Date);
check("the password is a bcrypt hash, not plaintext", /^\$2[aby]\$\d{2}\$/.test(doc?.password ?? ""), `${String(doc?.password).slice(0, 7)}…`);
check("the plaintext password is not stored anywhere", !JSON.stringify(doc).includes(password));
check("the API response omits the password", !("password" in (created.data.user ?? {})));

console.log("\nREAD — GET /api/auth/me and POST /api/auth/login");
const me = await api("/auth/me", { token: created.data.token });
check("the account reads back by token", me.status === 200 && me.data.user?.email === email.toLowerCase());
check("the read response still omits the password", !("password" in (me.data.user ?? {})));

const login = await api("/auth/login", { method: "POST", body: { email, password } });
check("the account reads back by credentials", login.status === 200, `status ${login.status}`);
check("login returns a token", typeof login.data.token === "string");

console.log("\nUPDATE — PATCH /api/auth/me");
const newEmail = `crud.updated.${Date.now()}@example.com`;
const updated = await api("/auth/me", {
  method: "PATCH",
  token: created.data.token,
  body: { name: "Renamed Person", email: newEmail.toUpperCase() },
});
check("the update is accepted", updated.status === 200, `status ${updated.status}`);

doc = await find(newEmail.toLowerCase());
check("the stored name changed", doc?.name === "Renamed Person", doc?.name);
check("the stored email changed and was lowercased", doc?.email === newEmail.toLowerCase(), doc?.email);
check("the old email no longer resolves", (await find(email)) === null);
check("_id is unchanged by the update", String(doc?._id) === String(created.data.user?.id ?? doc?._id));
check("createdAt was not modified by the update", doc?.createdAt instanceof Date);

console.log("\nUPDATE — PATCH /api/auth/me/password");
const beforeHash = doc?.password;
const changed = await api("/auth/me/password", {
  method: "PATCH",
  token: created.data.token,
  body: { currentPassword: password, newPassword: "BrandNewPass456!" },
});
check("the password change is accepted", changed.status === 200, `status ${changed.status} ${changed.data?.message ?? ""} ${JSON.stringify(changed.data?.details ?? {})}`);

doc = await find(newEmail.toLowerCase());
check("the stored hash changed", doc?.password !== beforeHash, `doc found: ${Boolean(doc)}`);
check("the new password still hashes (it is not plaintext)", /^\$2[aby]\$\d{2}\$/.test(doc?.password ?? ""), `${String(doc?.password).slice(0, 10)}…`);
check("the old password no longer logs in", (await api("/auth/login", { method: "POST", body: { email: newEmail, password } })).status === 401);
check("the new password does log in", (await api("/auth/login", { method: "POST", body: { email: newEmail, password: "BrandNewPass456!" } })).status === 200);

console.log("\nDELETE — DELETE /api/auth/me");
const deleted = await api("/auth/me", { method: "DELETE", token: created.data.token });
check("the account is deleted", deleted.status === 200, `status ${deleted.status}`);
check("no document remains in intelme.users", (await find(newEmail)) === null);
const after = await db.collection("users").countDocuments();
check("the collection is back to its original size", after === baseline, `${baseline} before, ${after} after`);

console.log("\nEMBEDDED STORAGE — one document holds the whole account");
const email2 = `crud.embedded.${Date.now()}@example.com`;
const second = await api("/auth/register", { method: "POST", body: { name: "Nested Tester", email: email2, password } });
check("a second account is created", second.status === 201, `status ${second.status}`);

const embedded = await find(email2);
check("a new account starts with three empty arrays",
  Array.isArray(embedded.resumes) && Array.isArray(embedded.analyses) && Array.isArray(embedded.jobs) &&
    embedded.resumes.length === 0 && embedded.analyses.length === 0 && embedded.jobs.length === 0,
  `resumes=${embedded.resumes?.length} analyses=${embedded.analyses?.length} jobs=${embedded.jobs?.length}`);

const fileName = `crudcheck-${Date.now()}.txt`;
const filePath = path.join(UPLOAD_DIR, fileName);
fs.writeFileSync(filePath, "placeholder for the storage check");
const resumeId = new mongoose.Types.ObjectId();
const analysisId = new mongoose.Types.ObjectId();
const jobId = new mongoose.Types.ObjectId();

await db.collection("users").updateOne(
  { email: email2 },
  {
    $push: {
      resumes: { _id: resumeId, label: "Nested", originalName: fileName, storedName: fileName, fileType: "txt", fileSize: 30, filePath, fileUrl: `/api/resumes/${resumeId}/file`, extractionMethod: "text", extractedText: "Nested Tester resume text", createdAt: new Date() },
      analyses: { _id: analysisId, resume: resumeId, score: 77, verdict: "Strong match", createdAt: new Date() },
      jobs: { _id: jobId, resume: resumeId, analysis: analysisId, jobTitle: "Nested Role", company: "Nested Co", score: 70, createdAt: new Date() },
    },
  },
);

const seeded = await find(email2);
check("the three entries are stored inside the account document",
  seeded.resumes.length === 1 && seeded.analyses.length === 1 && seeded.jobs.length === 1,
  `resumes=${seeded.resumes.length} analyses=${seeded.analyses.length} jobs=${seeded.jobs.length}`);
check("the entries carry no owner field",
  seeded.resumes[0].user === undefined && seeded.analyses[0].user === undefined && seeded.jobs[0].user === undefined);
check("the analysis points at the nested resume", String(seeded.analyses[0].resume) === String(resumeId));
check("the match points at the nested resume and analysis",
  String(seeded.jobs[0].resume) === String(resumeId) && String(seeded.jobs[0].analysis) === String(analysisId));
check("the resume keeps its own file path", seeded.resumes[0].filePath === filePath);
check("writing them created no extra collection", (await collectionNames()).join(", ") === "users", (await collectionNames()).join(", "));

const listed = await api("/resumes", { token: second.data.token });
check("the API serves the nested resume", listed.data?.count === 1 && listed.data?.resumes?.[0]?.id === String(resumeId), `count=${listed.data?.count} ${listed.data?.message ?? ""}`);
check("the API does not leak the file path", (listed.data?.resumes?.[0]?.filePath ?? null) === null, JSON.stringify(listed.data?.resumes?.[0]?.filePath));

const history = await api("/jobs", { token: second.data.token });
check("the API serves the nested match", history.data?.count === 1 && history.data?.matches?.[0]?.id === String(jobId), `count=${history.data?.count} ${history.data?.message ?? ""}`);

await api("/auth/me", { method: "DELETE", token: second.data.token });
check("deleting the account takes the nested data with it", (await find(email2)) === null);
check("and unlinks the file it owned", !fs.existsSync(filePath));
check("still only the users collection", (await collectionNames()).join(", ") === "users", (await collectionNames()).join(", "));
check("the collection is still at its original size", (await db.collection("users").countDocuments()) === baseline);

console.log(failures === 0 ? "\nAll user CRUD checks passed." : `\n${failures} user CRUD check(s) failed.`);
await mongoose.disconnect();
process.exit(failures === 0 ? 0 : 1);
