/**
 * Hygiene check for the test suites.
 *
 * Both `checkHttp.js` and the client suite create real accounts against the
 * configured database. They clean up after themselves through the API, but a
 * crashed run can leave one behind, and that is worth knowing about rather than
 * discovering later. By default this only ever reports.
 *
 * What is left behind is now trivially small — an account document holds a name,
 * an email and a password hash, and no CV data is written to the server at all —
 * so `--purge` is a straight `deleteMany` with no files to unlink first. It also
 * asserts the invariant that matters most here: nothing in `users` should carry a
 * resume, an analysis or a job match.
 */

import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
const db = mongoose.connection.db;

const TEST_ACCOUNT = /^(client|other|e2e|probe|crud)\./;
const LEAKED_FIELDS = ["resumes", "analyses", "jobs"];

const collections = async () =>
  (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();

/**
 * The sizes of the three fields that must never be there. A `$project` stage is
 * one object, so these are merged rather than listed.
 */
const NESTED_SIZES = LEAKED_FIELDS.reduce(
  (project, field) => ({ ...project, [field]: { $size: { $ifNull: [`$${field}`, []] } } }),
  {},
);

const NESTED_EXISTS = LEAKED_FIELDS.map((field) => ({ [field]: { $gt: 0 } }));

if (process.argv.includes("--purge")) {
  const removed = await db.collection("users").deleteMany({ email: TEST_ACCOUNT });

  console.log(`removed ${removed.deletedCount} test account(s)`);
  console.log(`users remaining: ${await db.collection("users").countDocuments()}`);
} else {
  console.log(`collections: ${(await collections()).join(", ")}`);
  console.log(`accounts: ${await db.collection("users").countDocuments()}`);

  const leaked = await db
    .collection("users")
    .aggregate([
      { $project: NESTED_SIZES },
      { $match: { $or: NESTED_EXISTS } },
      { $count: "documents" },
    ])
    .toArray();

  const leaking = leaked[0]?.documents ?? 0;

  console.log(
    leaking === 0
      ? "no account document holds CV data — the database is account details only"
      : `${leaking} account(s) still hold CV data; run purgeStoredDocuments.mjs`,
  );

  const leftovers = await db
    .collection("users")
    .find({ email: TEST_ACCOUNT })
    .project({ email: 1, createdAt: 1 })
    .toArray();

  if (!leftovers.length) {
    console.log("no leftover test accounts");
  } else {
    console.log(`${leftovers.length} test account(s) left behind:`);
    for (const user of leftovers) {
      console.log(`  ${user.email}  ${user.createdAt?.toISOString?.() ?? ""}`);
    }
    console.log("run with --purge to remove them");
  }
}

await mongoose.disconnect();
process.exit(0);