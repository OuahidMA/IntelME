/**
 * Removes everything the app used to store about a candidate's CV.
 *
 * An account document used to nest its resumes, analyses and job matches. The
 * database now holds three fields per user — a name, an email and a password hash
 * — and those documents carry CV text, extracted profile details and job
 * postings that no longer belong there and cannot be fetched from anywhere else.
 *
 * This is the one-way migration: it deletes that data, it does not move it into
 * the browser, because it cannot. There is nowhere to move it to — the copy that
 * matters is the one a user already has in their own storage, and the copy in
 * MongoDB is the wrong place for a CV to have been in the first place.
 *
 *   node scripts/purgeStoredDocuments.mjs --dry-run   report, change nothing
 *   node scripts/purgeStoredDocuments.mjs             delete, then verify
 *
 * Safe to run twice: the second pass finds no nested arrays, and the legacy
 * collections it looks for no longer exist.
 */

import "dotenv/config";
import mongoose from "mongoose";

const LEGACY_FIELDS = ["resumes", "analyses", "jobs"];
const LEGACY_COLLECTIONS = ["resumes", "analyses", "jobs"];

/**
 * The sizes of the fields to remove, and a filter for documents that have any of
 * them. A `$project` stage is one object, so the sizes are merged rather than
 * listed — an array of single-key stages is rejected by the server.
 */
const NESTED_SIZES = LEGACY_FIELDS.reduce(
  (project, field) => ({ ...project, [field]: { $size: { $ifNull: [`$${field}`, []] } } }),
  {},
);

const NESTED_EXISTS = LEGACY_FIELDS.map((field) => ({ [field]: { $gt: 0 } }));

const dryRun = process.argv.includes("--dry-run");

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
const db = mongoose.connection.db;

console.log(`database: ${db.databaseName} (${dryRun ? "dry run" : "live"})`);

const accounts = await db.collection("users").countDocuments();
console.log(`accounts: ${accounts}`);

/* ---------------- what is still nested in an account ---------------- */

const affected = await db
  .collection("users")
  .aggregate([
    { $project: NESTED_SIZES },
    { $match: { $or: NESTED_EXISTS } },
    {
      $group: {
        _id: null,
        resumes: { $sum: "$resumes" },
        analyses: { $sum: "$analyses" },
        jobs: { $sum: "$jobs" },
        accounts: { $sum: 1 },
      },
    },
  ])
  .toArray();

const totals = affected[0] ?? { resumes: 0, analyses: 0, jobs: 0, accounts: 0 };

console.log(
  `still nested: ${totals.resumes} resume(s), ${totals.analyses} analysis/analyses, ` +
    `${totals.jobs} job match(es), across ${totals.accounts} account(s)`,
);

if (totals.accounts === 0) {
  console.log("\nnothing to purge: no account holds CV data.");
} else if (dryRun) {
  console.log("\ndry run: nothing was deleted.");
} else {
  const result = await db.collection("users").updateMany(
    { $or: LEGACY_FIELDS.map((field) => ({ [field]: { $exists: true } })) },
    { $unset: LEGACY_FIELDS.reduce((unset, field) => ({ ...unset, [field]: "" }), {}) },
  );

  console.log(`\nunlinked the nested arrays from ${result.modifiedCount} account(s)`);
}

/* ---------------- legacy top-level collections ---------------- */

const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
const present = LEGACY_COLLECTIONS.filter((name) => existing.has(name));

for (const name of present) {
  const count = await db.collection(name).countDocuments();

  if (dryRun) {
    console.log(`collection ${name}: ${count} document(s) — would be dropped`);
  } else {
    await db.collection(name).drop();
    console.log(`dropped collection: ${name} (${count} document(s))`);
  }
}

if (present.length === 0) console.log("no legacy collections to drop");

/* ---------------- verify ---------------- */

if (!dryRun) {
  const remaining = await db
    .collection("users")
    .aggregate([
      { $project: NESTED_SIZES },
      { $match: { $or: NESTED_EXISTS } },
    ])
    .toArray();

  console.log(
    remaining.length === 0
      ? "verified: no account document holds CV data"
      : `STILL PRESENT: ${remaining.length} account(s) hold CV data`,
  );

  const sample = await db.collection("users").findOne({});

  if (sample) {
    const fields = Object.keys(sample).sort().join(", ");
    console.log(`sample document fields: ${fields}`);
  }

  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .sort()
    .join(", ");
  console.log(`collections: ${names}`);
}

await mongoose.disconnect();
process.exit(0);