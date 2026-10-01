import { assertObjectId, ValidationError } from "../utils/validators.js";

/**
 * Every read and write of the data that lives inside an account document.
 *
 * Resumes, analyses and job matches are embedded in the user that owns them, so
 * there is nothing to query against and no second collection to read from: the
 * signed-in account document (`req.user`, loaded once per request by
 * `protect`) *is* the record. Every function here takes that document, which is
 * also what makes the ownership check total — an entry that is not in the array
 * belongs to somebody else, full stop.
 *
 * Two consequences run through the whole file:
 *
 *  - Sorting and filtering happen in JavaScript. The arrays are already in
 *    memory, and the alternative — an aggregation pipeline to sort three entries
 *    out of one document — would be more code for the same answer.
 *  - Writes mutate the loaded document and `save()` it. Mongoose only sends the
 *    paths that actually changed, so a status update on one resume is a `$set`
 *    on that element rather than a rewrite of the account.
 */

/** Upper bound on any page the API will serve, whatever the caller asks for. */
const MAX_PAGE = 100;

const idOf = (entry) => String(entry?._id ?? entry ?? "");

/** Timestamps as plain numbers, so a missing date sorts first instead of NaN. */
const timeOf = (value) => new Date(value ?? 0).getTime();

function sameId(left, right) {
  return idOf(left) === idOf(right);
}

/** A plain copy of a Mongoose array: sorting these must not touch the schema. */
const plain = (list) => Array.from(list ?? []);

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

/* ------------------------------------------------------------------ *
 * Lookups
 * ------------------------------------------------------------------ */

/**
 * The caller's own resume, or null.
 *
 * The id is validated as an ObjectId before it is compared so a malformed id
 * fails loudly (400) instead of quietly matching nothing (404).
 */
export function findResume(user, resumeId) {
  const id = assertObjectId(resumeId, "resume id");
  return plain(user.resumes).find((resume) => sameId(resume._id, id)) ?? null;
}

/** As `findResume`, but for an id that came out of our own data. */
export function resolveResume(user, reference) {
  const id = idOf(reference);
  if (!id) return null;

  return plain(user.resumes).find((resume) => sameId(resume._id, id)) ?? null;
}

export function requireResume(user, resumeId) {
  const resume = findResume(user, resumeId);

  if (!resume) throw notFound("Resume not found.");

  return resume;
}

/** The newest analysis of one resume, or null. */
export function latestAnalysisFor(user, resumeId) {
  const id = idOf(resumeId);

  const matches = plain(user.analyses)
    .filter((analysis) => sameId(analysis.resume, id))
    .sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));

  return matches[0] ?? null;
}

/**
 * The analysis a job match needs: the newest one for a resume the caller owns.
 * Distinguishes "no such version" (404) from "not analysed yet" (400), which is
 * the difference between a wrong id and an action the user has not taken yet.
 */
export function requireAnalysis(user, resumeId) {
  const resume = requireResume(user, resumeId);
  const analysis = latestAnalysisFor(user, resume._id);

  if (!analysis) {
    throw new ValidationError("Analyse this resume before matching it against a job.");
  }

  return { resume, analysis };
}

export function findJob(user, jobId) {
  const id = assertObjectId(jobId, "match id");
  return plain(user.jobs).find((job) => sameId(job._id, id)) ?? null;
}

export function requireJob(user, jobId) {
  const job = findJob(user, jobId);

  if (!job) throw notFound("Job match not found.");

  return job;
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Appends a subdocument and saves.
 *
 * Mongoose assigns the `_id` when the entry is pushed, so the caller can fill in
 * anything derived from it (a download URL, for one) before the single write
 * that persists the whole thing.
 */
async function append(user, path, payload) {
  user[path].push(payload);

  const entry = user[path][user[path].length - 1];

  await user.save();

  return entry;
}

export function pushResume(user, payload) {
  return append(user, "resumes", payload);
}

export function pushAnalysis(user, payload) {
  return append(user, "analyses", payload);
}

export function pushJob(user, payload) {
  return append(user, "jobs", payload);
}

/**
 * Drops every analysis of a resume except the one just produced, so re-running an
 * analysis replaces it rather than piling up.
 *
 * The `user` filter is not optional here: without it the pruning would reach
 * across accounts and delete another user's analysis of a resume that happened to
 * carry the same id.
 */
export async function pruneOldAnalyses(user, resumeId, keepId) {
  const resume = idOf(resumeId);
  const stale = plain(user.analyses).filter(
    (analysis) => sameId(analysis.resume, resume) && !sameId(analysis._id, keepId),
  );

  if (stale.length === 0) return;

  const staleIds = new Set(stale.map((analysis) => idOf(analysis._id)));

  user.analyses = plain(user.analyses).filter((analysis) => !staleIds.has(idOf(analysis._id)));

  await user.save();
}

/**
 * Removes a version and everything computed from it: its analyses and any job
 * match scored against it.
 *
 * Returns the removed entry so the caller can still read `filePath` after it is
 * gone from the document — the file on disk has to be unlinked too.
 */
export async function removeResume(user, resumeId) {
  const resume = requireResume(user, resumeId);
  const id = idOf(resume._id);

  const filePath = resume.filePath;

  user.resumes = plain(user.resumes).filter((entry) => !sameId(entry._id, id));
  user.analyses = plain(user.analyses).filter((analysis) => !sameId(analysis.resume, id));
  user.jobs = plain(user.jobs).filter((job) => !sameId(job.resume, id));

  await user.save();

  return { id, filePath };
}

export async function removeJob(user, jobId) {
  const job = requireJob(user, jobId);

  user.jobs = plain(user.jobs).filter((entry) => !sameId(entry._id, job._id));

  await user.save();
}

export async function clearJobs(user) {
  const removed = user.jobs.length;

  user.jobs = [];

  await user.save();

  return removed;
}

/* ------------------------------------------------------------------ *
 * Reading the history back out
 * ------------------------------------------------------------------ */

/**
 * `?cursor=` support, kept compatible with the shape `parseCursor` produces.
 *
 * A cursor is the "everything strictly older than this" marker. ObjectIds are
 * fixed-width hex, so comparing the strings orders them exactly as the driver
 * would have.
 */
function afterCursor(entry, cursor) {
  if (!cursor) return true;

  if (cursor._id) return idOf(entry._id) < idOf(cursor._id.$lt);
  if (cursor.createdAt) return timeOf(entry.createdAt) < timeOf(cursor.createdAt.$lt);

  return true;
}

/** Orders numbers, dates and strings, so one comparator can serve every sort. */
function compareValues(a, b) {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;

  if (typeof left === "number" && typeof right === "number") return left - right;

  return String(left ?? "").localeCompare(String(right ?? ""));
}

/**
 * Sorts by the whitelisted `{ field: direction }` object the query string is
 * parsed into, with the id as a tiebreaker so equal scores keep a stable order
 * across pages.
 */
function sortEntries(entries, sort) {
  const [field, direction] = Object.entries(sort ?? {})[0] ?? ["createdAt", -1];
  const sign = direction === 1 ? 1 : -1;

  return entries.sort((a, b) => {
    const primary = compareValues(a[field], b[field]) * sign;

    return primary !== 0 ? primary : idOf(a._id).localeCompare(idOf(b._id)) * -sign;
  });
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every version this account has uploaded, newest first. */
export function listResumeVersions(user, { limit = 50, cursor = null } = {}) {
  const page = Math.min(Number.parseInt(limit, 10) || 50, MAX_PAGE);

  const entries = sortEntries(
    plain(user.resumes).filter((resume) => afterCursor(resume, cursor)),
    { createdAt: -1 },
  );

  return entries.slice(0, page);
}

/** The compact resume record the analysis rows carry. */
export function summariseResume(resume) {
  if (!resume) return null;

  return {
    id: idOf(resume._id),
    originalName: resume.originalName,
    label: resume.label,
    fileType: resume.fileType,
    createdAt: resume.createdAt,
  };
}

/** Every analysis this account has, newest first, with its resume resolved. */
export function listAnalysesWithResume(user) {
  return sortEntries(plain(user.analyses), { createdAt: -1 }).map((analysis) => ({
    analysis,
    resume: resolveResume(user, analysis.resume),
  }));
}

/**
 * "My job matches": filtered and sorted in memory, the same way MongoDB did it
 * against a collection, because the matches are already in the account document.
 */
export function listJobMatches(
  user,
  { resumeId = null, search = "", min, max, sort = { createdAt: -1 }, limit = 20, cursor = null } = {},
) {
  const page = Math.min(Number.parseInt(limit, 10) || 20, MAX_PAGE);
  const pattern = search ? new RegExp(escapeRegExp(search), "i") : null;

  const entries = plain(user.jobs).filter((job) => {
    if (resumeId && !sameId(job.resume, resumeId)) return false;

    if (min !== undefined && job.score < min) return false;
    if (max !== undefined && job.score > max) return false;

    if (pattern && !pattern.test(job.jobTitle ?? "") && !pattern.test(job.company ?? "")) {
      return false;
    }

    return afterCursor(job, cursor);
  });

  return sortEntries(entries, sort).slice(0, page);
}
