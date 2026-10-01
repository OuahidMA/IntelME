/**
 * Folds the old per-account collections into the `users` document and removes
 * them.
 *
 * Before this change a CV, its analyses and its job matches were separate
 * documents in `resumes`, `analyses` and `jobs`, each pointing at a user. They
 * are now subdocuments of that user, so `users` is the only collection the app
 * writes. This moves anything written by the old layout into its owning account
 * and then drops the three collections, so no data is stranded and nothing is
 * left to hint that they were ever there.
 *
 *   node scripts/migrateToEmbedded.mjs --dry-run   report, change nothing
 *   node scripts/migrateToEmbedded.mjs             migrate and drop
 *
 * It is safe to run twice: the second pass finds nothing to move and the
 * collections it looks for no longer exist. `_id`s are carried over untouched,
 * so ids already handed to a client — a resume in a URL, the link from a match
 * to its analysis — keep resolving after the move.
 */

import "dotenv/config";
import mongoose from "mongoose";

import { removeStoredFile } from "../middleware/uploadMiddleware.js";

const LEGACY = [
  { collection: "resumes", field: "resumes" },
  { collection: "analyses", field: "analyses" },
  { collection: "jobs", field: "jobs" },
];

const dryRun = process.argv.includes("--dry-run");

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
const db = mongoose.connection.db;

const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
const present = LEGACY.filter(({ collection }) => existing.has(collection));

console.log(`database: ${db.databaseName} (${dryRun ? "dry run" : "live"})`);

if (present.length === 0) {
  console.log("\nnothing to migrate: the account document already holds everything.");
  await mongoose.disconnect();
  process.exit(0);
}

let moved = 0;
let unlinked = 0;
let orphaned = 0;

for (const { collection, field } of present) {
  const docs = await db.collection(collection).find().toArray();

  if (docs.length === 0) {
    console.log(`${collection}: empty`);
    continue;
  }

  // Grouped by owning account, so each user document is written once.
  const byUser = new Map();

  for (const doc of docs) {
    const owner = String(doc.user ?? "");
    if (!byUser.has(owner)) byUser.set(owner, []);
    byUser.get(owner).push(doc);
  }

  let collectionMoved = 0;

  for (const [owner, entries] of byUser) {
    const ownerId = mongoose.Types.ObjectId.isValid(owner)
      ? new mongoose.Types.ObjectId(owner)
      : null;

    const user = ownerId
      ? await db
          .collection("users")
          .findOne({ _id: ownerId }, { projection: { [`${field}._id`]: 1 } })
      : null;

    if (!user) {
      // The account is gone, so there is nowhere to put these. Files are
      // unlinked now, while the path that reaches them is still on record.
      for (const entry of entries) {
        if (field === "resumes") {
          if (!dryRun) removeStoredFile(entry.filePath);
          unlinked += 1;
        }
        orphaned += 1;
      }

      console.log(`${collection}: ${entries.length} document(s) had no account, skipped`);
      continue;
    }

    // Already carried over by an earlier run: keep the copy that exists.
    const alreadyThere = new Set((user[field] ?? []).map((entry) => String(entry._id)));
    const fresh = entries.filter((entry) => !alreadyThere.has(String(entry._id)));

    if (fresh.length === 0) continue;

    // The `user` field is dropped: the account document is the owner now, and
    // the subdocument schema has no path for it.
    const payload = fresh.map(({ user: _owner, ...entry }) => entry);

    if (!dryRun) {
      await db.collection("users").updateOne({ _id: user._id }, { $push: { [field]: payload } });
    }

    collectionMoved += fresh.length;
  }

  moved += collectionMoved;
  console.log(`${collection}: ${collectionMoved} document(s) nested into intelme.users`);
}

console.log(`\ntotal moved      : ${moved}`);
console.log(`orphaned         : ${orphaned} (no owning account)`);
console.log(`files unlinked   : ${unlinked}`);

if (dryRun) {
  console.log("\ndry run: nothing was written and no collection was dropped.");
} else {
  for (const { collection } of present) {
    await db.collection(collection).drop();
    console.log(`dropped collection: ${collection}`);
  }
}

const accounts = await db
  .collection("users")
  .aggregate([
    {
      $project: {
        resumes: { $size: { $ifNull: ["$resumes", []] } },
        analyses: { $size: { $ifNull: ["$analyses", []] } },
        jobs: { $size: { $ifNull: ["$jobs", []] } },
      },
    },
    {
      $group: {
        _id: null,
        resumes: { $sum: "$resumes" },
        analyses: { $sum: "$analyses" },
        jobs: { $sum: "$jobs" },
      },
    },
  ])
  .toArray();

const totals = accounts[0] ?? { resumes: 0, analyses: 0, jobs: 0 };

console.log(
  `\nusers: ${await db.collection("users").countDocuments()} account(s), ` +
    `holding ${totals.resumes} resume(s), ${totals.analyses} analysis/analyses, ${totals.jobs} job match(es)`,
);

await mongoose.disconnect();
process.exit(0);
