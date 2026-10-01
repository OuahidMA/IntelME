/**
 * Hygiene check for the test suites.
 *
 * Both `checkHttp.js` and the client suite create real accounts against the
 * configured database. They clean up after themselves through the API, but a
 * crashed run can leave one behind, and that is worth knowing about rather than
 * discovering later. By default this only ever reports.
 *
 * `--purge` removes the accounts the suites create. Each account is one document
 * holding its own resumes, analyses and job matches, so removing the account
 * removes them all — but the uploaded files on disk are not part of that document
 * and have to be unlinked first, or they stay there forever.
 */

import "dotenv/config";
import mongoose from "mongoose";

import { removeStoredFile } from "../middleware/uploadMiddleware.js";

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
const db = mongoose.connection.db;

const TEST_ACCOUNT = /^(client|other|e2e|probe)\./;
const collections = async () => (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();

if (process.argv.includes("--purge")) {
  const accounts = await db
    .collection("users")
    .find({ email: TEST_ACCOUNT })
    .project({ _id: 1, email: 1, resumes: 1 })
    .toArray();

  // The files first: once the document is gone the paths are unrecoverable.
  let files = 0;
  let resumes = 0;
  let analyses = 0;
  let jobs = 0;

  for (const account of accounts) {
    for (const resume of account.resumes ?? []) {
      // `filePath` is `select: false` on the schema, so this raw read is the
      // only way to reach it here.
      removeStoredFile(resume.filePath);
      files += 1;
    }
    resumes += account.resumes?.length ?? 0;
    analyses += account.analyses?.length ?? 0;
    jobs += account.jobs?.length ?? 0;
  }

  const removed = await db.collection("users").deleteMany({ email: TEST_ACCOUNT });

  console.log(
    `removed ${removed.deletedCount} account(s), taking ${resumes} resume(s) (${files} file(s) unlinked), ` +
      `${analyses} analysis/analyses and ${jobs} job match(es) with them`,
  );
  console.log(`users remaining: ${await db.collection("users").countDocuments()}`);
} else {
  console.log(`collections: ${(await collections()).join(", ")}`);

  const stored = await db
    .collection("users")
    .aggregate([
      {
        $group: {
          _id: null,
          accounts: { $sum: 1 },
          resumes: { $sum: { $size: { $ifNull: ["$resumes", []] } } },
          analyses: { $sum: { $size: { $ifNull: ["$analyses", []] } } },
          jobs: { $sum: { $size: { $ifNull: ["$jobs", []] } } },
        },
      },
    ])
    .toArray();

  const total = stored[0] ?? { accounts: 0, resumes: 0, analyses: 0, jobs: 0 };
  console.log(`accounts: ${total.accounts}, resumes: ${total.resumes}, analyses: ${total.analyses}, job matches: ${total.jobs} — all inside the users documents`);

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
    console.log("run with --purge to remove them, along with their files");
  }
}

await mongoose.disconnect();
process.exit(0);
