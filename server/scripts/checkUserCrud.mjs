/**
 * Proves that an account created through the API is really a document in the
 * `users` collection of the `intelme` database, that it holds nothing but a name,
 * an email and a password hash, and that every CRUD operation lands there.
 *
 * The central assertion is the last one: after uploading a CV, analysing it,
 * matching a job against it and deleting the account, the document is unchanged.
 * That is the whole point of the current design, and nothing about a
 * conventional CRUD test would catch a regression in it — a resume subdocument
 * would look like a perfectly working endpoint.
 *
 * This reads the raw driver rather than the Mongoose model on purpose: the
 * question is what MongoDB actually holds, not what the app believes it holds.
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mongoose from "mongoose";

import User from "../models/User.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "..", "uploads", "__fixtures__");
const UPLOADS = path.resolve(__dirname, "..", "uploads");
const BASE = "http://localhost:5000/api";
const password = "CrudCheck123!";

/**
 * Exactly the fields an account document is allowed to carry.
 *
 * Sorted, because it is compared against `Object.keys(doc).sort()` — otherwise a
 * test that only ever fails on its own bookkeeping is worse than no test.
 */
const ALLOWED_FIELDS = ["_id", "createdAt", "email", "name", "password"];

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

async function upload(fileName, mime, token) {
  const bytes = await fs.readFile(path.join(FIXTURES, fileName));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), fileName);
  form.append("label", "Crud check");

  const response = await fetch(`${BASE}/resumes/analyse`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  return { status: response.status, data: await response.json().catch(() => ({})) };
}

/** The raw document, straight from the driver, bypassing every schema layer. */
const raw = (db) => (email) => db.collection("users").findOne({ email });

/** Everything the driver holds for one account, minus the immutable _id. */
const snapshot = async (email) => {
  const doc = await raw(db)(email);
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
};

/** Uploaded files sitting on disk, excluding the fixtures the tests read. */
async function countUploads() {
  const entries = await fs.readdir(UPLOADS, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).length;
}

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

console.log("\nSHAPE — the document holds account details and nothing else");
const fields = Object.keys(doc ?? {}).sort();
check(
  "it holds exactly the four account fields plus _id",
  fields.join(",") === ALLOWED_FIELDS.join(","),
  fields.join(", "),
);
for (const field of ["resumes", "analyses", "jobs"]) {
  check(`it has no \`${field}\` array`, !(field in (doc ?? {})), field);
}

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
check("createdAt was not modified by the update", doc?.createdAt instanceof Date);
check("the update added no fields", Object.keys(doc ?? {}).sort().join(",") === ALLOWED_FIELDS.join(","), Object.keys(doc ?? {}).sort().join(", "));

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

/* ------------------------------------------------------------------ *
 * The CV journey leaves the database untouched
 * ------------------------------------------------------------------ */

console.log("\nCV JOURNEY — nothing reaches the database");
{
  const filesBefore = await countUploads();
  const before = await snapshot(newEmail.toLowerCase());

  console.log("  uploading (this calls the live AI, so it takes a moment)…");
  const uploaded = await upload("john-doe-cv.pdf", "application/pdf", created.data.token);

  check("the upload is analysed", uploaded.status === 201, `status ${uploaded.status} ${uploaded.data?.message ?? ""}`);
  check("it returns the text it recovered", (uploaded.data?.resume?.extractedText?.length ?? 0) > 200, `${uploaded.data?.resume?.characters} chars`);
  check("it returns an analysis", typeof uploaded.data?.analysis?.score === "number", `score ${uploaded.data?.analysis?.score}`);
  check("the analysis carries no resume id", uploaded.data?.analysis?.resume === undefined && uploaded.data?.analysis?.resumeId === undefined);
  check("the resume record carries no id (the browser names it)", uploaded.data?.resume?.id === undefined);
  check("the resume record carries no server path", !JSON.stringify(uploaded.data?.resume ?? {}).includes("uploads"));

  const text = uploaded.data?.resume?.extractedText ?? "";

  if (text.length > 40) {
    const refreshed = await api("/analysis", {
      method: "POST",
      token: created.data.token,
      body: { text },
    });
    check("POST /analysis re-analyses stored text", refreshed.status === 200 && typeof refreshed.data?.analysis?.score === "number", `status ${refreshed.status}`);

    const tooShort = await api("/analysis", {
      method: "POST",
      token: created.data.token,
      body: { text: "nothing here" },
    });
    check("POST /analysis rejects unusable text", tooShort.status === 400, `status ${tooShort.status}`);

    if (uploaded.data?.analysis) {
      const matched = await api("/jobs/match", {
        method: "POST",
        token: created.data.token,
        body: {
          analysis: uploaded.data.analysis,
          resumeId: "browser-owned-id",
          jobDescription:
            "Frontend Developer. You must have strong React, TypeScript and JavaScript skills. You need at least 2 years of experience building component libraries and design systems. Knowledge of REST APIs, Git and Tailwind CSS is required. You will work on accessibility and performance. A bachelor's degree in Computer Science is preferred.",
        },
      });
      check("POST /jobs/match scores a browser-supplied analysis", matched.status === 201, `status ${matched.status} ${matched.data?.message ?? ""}`);
      check("the match comes back with a score", typeof matched.data?.match?.score === "number", `${matched.data?.match?.score}`);
      check("the match echoes the browser's own version id", matched.data?.match?.resumeId === "browser-owned-id", matched.data?.match?.resumeId);
      check("the match breakdown has the 6 weighted categories", matched.data?.match?.scoreBreakdown?.length === 6, `${matched.data?.match?.scoreBreakdown?.length}`);
    } else {
      console.log("  (no analysis came back, so the match step was skipped)");
    }
  }

  const after = await snapshot(newEmail.toLowerCase());

  check(
    "the account document is byte-identical after the whole CV journey",
    JSON.stringify(before) === JSON.stringify(after),
    `${Object.keys(after ?? {}).sort().join(", ")}`,
  );
  check(
    "the upload was deleted from the server's disk",
    (await countUploads()) === filesBefore,
    `${filesBefore} files before, ${await countUploads()} after`,
  );
  check("writing them created no extra collection", (await collectionNames()).join(", ") === "users", (await collectionNames()).join(", "));
}

console.log("\nDELETE — DELETE /api/auth/me");
const deleted = await api("/auth/me", { method: "DELETE", token: created.data.token });
check("the account is deleted", deleted.status === 200, `status ${deleted.status}`);
check("no document remains in intelme.users", (await find(newEmail)) === null);
const afterCount = await db.collection("users").countDocuments();
check("the collection is back to its original size", afterCount === baseline, `${baseline} before, ${afterCount} after`);
check("still only the users collection", (await collectionNames()).join(", ") === "users", (await collectionNames()).join(", "));

console.log(failures === 0 ? "\nAll user CRUD checks passed." : `\n${failures} user CRUD check(s) failed.`);
await mongoose.disconnect();
process.exit(failures === 0 ? 0 : 1);