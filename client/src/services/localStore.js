/**
 * Where everything except the account lives.
 *
 * The database holds three fields per user: a name, an email and a bcrypt hash.
 * Every CV version, the analysis of each one and every job match are the
 * candidate's own data, so they are kept in their own browser under this key and
 * never sent to us to be stored.
 *
 *   intelme.data.<userId> -> { version, resumes, matches }
 *
 * The key is scoped to the account id, which is what stops two people using the
 * same browser from seeing each other's documents — signing in as somebody else
 * reads a different key entirely, and signing back in restores yours.
 *
 * A resume carries its own `analysis`, because a version and its score are one
 * unit: there is at most one live analysis per version, and re-running it
 * replaces that object rather than appending a second. The analysis is stored in
 * the shape the server returned it, not the shape the pages read, because the
 * pages need it mapped (`api.mapAnalysis`) and the server needs the original back
 * in order to score it against a posting.
 */

/** Bumped whenever the stored shape changes incompatibly; older data is discarded. */
export const SCHEMA_VERSION = 1;

const KEY_PREFIX = "intelme.data.";

/** A store we cannot write to — Safari private mode, or the origin quota is spent. */
export class LocalStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocalStoreError";
  }
}

/**
 * Subscribing to the store.
 *
 * `localStorage` is an external store, so components read it through
 * `useSyncExternalStore` rather than mirroring it in state. That is what makes a
 * failed write honest: there is no second copy that could claim a save succeeded
 * when nothing reached disk.
 */
const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called after every write, so a `useSyncExternalStore` reader re-reads. */
function notify() {
  for (const listener of listeners) listener();
}

/**
 * The `storage` event fires in *other* tabs on the same origin. Without this, a
 * version deleted in one window would still be on screen in another until a
 * reload — and reloading would bring it back, which reads as the delete failing.
 *
 * Registered lazily on first subscribe rather than at import, so this module
 * stays importable where `window` does not exist.
 */
let isWatchingOtherTabs = false;

function watchOtherTabs() {
  if (isWatchingOtherTabs) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;

  isWatchingOtherTabs = true;
  window.addEventListener("storage", () => notify());
}

/**
 * Reads and writes can both throw: a browser in private mode raises on
 * `setItem`, and a full origin raises `QuotaExceededError` on `setItem` while
 * reading still works. So every access is guarded and the failure is reported
 * rather than thrown into a React render.
 */
function storage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const keyFor = (userId) => `${KEY_PREFIX}${userId ?? ""}`

/** A fresh, empty workspace. Callers hold onto this; it is never mutated in place. */
export function emptyWorkspace() {
  return { version: SCHEMA_VERSION, resumes: [], matches: [] }
}

/**
 * Frozen and shared, so every signed-out read returns the *same* object and
 * `useSyncExternalStore` does not see a new snapshot on every render.
 */
const EMPTY = Object.freeze(emptyWorkspace())

/**
 * True for a value this module would have written. Anything else — a half-written
 * value, a shape from a future version, another tab's data mid-flight — is
 * discarded and replaced with an empty workspace rather than half-believed.
 */
function isWorkspace(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.version === SCHEMA_VERSION &&
    Array.isArray(value.resumes) &&
    Array.isArray(value.matches)
  )
}

function readRaw(userId) {
  const store = storage()
  if (!store) return null

  try {
    return store.getItem(keyFor(userId))
  } catch {
    return null
  }
}

function parse(raw) {
  if (!raw) return EMPTY

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Corrupt JSON is indistinguishable from no data as far as the app is
    // concerned, and refusing to start would be worse than starting empty.
    return EMPTY
  }

  return isWorkspace(parsed) ? parsed : EMPTY
}

/**
 * Caches the last parse, keyed on the account and on the exact string it came
 * from.
 *
 * The string is the cache key rather than the parsed object because
 * `useSyncExternalStore` compares snapshots with `Object.is` and will loop
 * forever if `getSnapshot` hands back a fresh object each call. Re-parsing only
 * when the raw text actually moved is what makes the identity stable.
 */
let cache = { key: null, raw: null, value: EMPTY }

/** The workspace for an account. Stable identity while the stored text is stable. */
export function getWorkspace(userId) {
  watchOtherTabs()

  const key = keyFor(userId)
  const raw = readRaw(userId)

  if (cache.key === key && cache.raw === raw) return cache.value

  const value = parse(raw)
  cache = { key, raw, value }
  return value
}

/**
 * Writes the workspace back.
 *
 * Throws `LocalStoreError` when the origin is out of room, because silently
 * dropping a CV the user just uploaded would be the worst possible failure here:
 * the screen would say it saved and a reload would disagree.
 *
 * @param {string} userId  the signed-in account, which owns this key
 * @param {{resumes: Array, matches: Array}} workspace
 */
export function writeWorkspace(userId, workspace) {
  const store = storage()

  if (!store) {
    throw new LocalStoreError(
      "This browser is blocking local storage, so your resume cannot be saved here.",
    )
  }

  const payload = JSON.stringify({
    version: SCHEMA_VERSION,
    resumes: workspace.resumes ?? [],
    matches: workspace.matches ?? [],
  })

  try {
    store.setItem(keyFor(userId), payload)
  } catch {
    throw new LocalStoreError(
      "This browser has run out of storage space. Delete an older version or a saved job match, then try again.",
    )
  }

  // The parse cache holds the pre-write string, so the next read misses and
  // re-parses rather than handing back the value that was just replaced.
  notify()
}

/**
 * Reads the current workspace, applies a change and writes it back.
 *
 * Reads from the store rather than from a value passed in, so two changes made
 * before React has re-rendered — rename, then delete, within one event handler —
 * compose instead of the second overwriting the first from a stale copy.
 */
export function updateWorkspace(userId, updater) {
  const current = getWorkspace(userId)
  const next = typeof updater === "function" ? updater(current) : updater

  writeWorkspace(userId, next)
  return next
}

/** Forgets everything stored for one account. Used on account deletion. */
export function clearWorkspace(userId) {
  const store = storage()

  watchOtherTabs()
  if (store) {
    try {
      store.removeItem(keyFor(userId))
    } catch {
      /* see getToken-style guards above: an unreachable store is already handled on read */
    }
  }

  notify()
}

/** Bytes this account is using, for the settings page. */
export function storageFootprint(userId) {
  const raw = readRaw(userId)
  if (!raw) return 0

  // TextEncoder is present in every browser this app targets; the fallback only
  // guards against a stubbed global in a test harness.
  const bytes = typeof TextEncoder === "function" ? new TextEncoder().encode(raw).length : raw.length
  return bytes
}

/** A v4 id, falling back where `crypto.randomUUID` is unavailable. */
export function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/* ------------------------------------------------------------------ *
 * Projections
 *
 * Everything the pages read is derived here rather than stored twice. These are
 * pure, so they are directly testable without a browser or a React tree.
 * ------------------------------------------------------------------ */

/**
 * Removes a version and everything computed from it: its analysis (it lives on
 * the version) and any match scored against it. Without this, deleting a CV
 * would leave behind rows pointing at an id that no longer resolves, and the
 * history would silently claim coverage of a document the user has erased.
 */
export function removeResume(workspace, resumeId) {
  return {
    ...workspace,
    resumes: workspace.resumes.filter((resume) => resume.id !== resumeId),
    matches: workspace.matches.filter((match) => match.resumeId !== resumeId),
  }
}

/**
 * One summary row per match, filtered and sorted the way the old `GET /jobs`
 * query string did it. Applied here because the matches are already in memory.
 *
 * @param {object} workspace
 * @param {{sort?: string, search?: string, min?: number, max?: number}} filter
 */
export function summariseMatches(workspace, filter = {}) {
  const { sort = "date:desc", search = "", min, max } = filter
  const needle = String(search ?? "").trim().toLowerCase()

  let rows = (workspace.matches ?? []).map((job) => ({
    id: job.id ?? null,
    resumeId: job.resumeId ?? job.resume ?? null,
    jobTitle: job.jobTitle || "Untitled role",
    company: job.company || "",
    score: job.score ?? 0,
    verdict: job.verdict || "",
    createdAt: job.createdAt ?? null,
    matchingSkills: (job.matchingSkills ?? []).map((row) => row?.name).filter(Boolean),
    missingSkills: (job.missingSkills ?? []).map((row) => row?.name).filter(Boolean),
  }))

  // Search covers the title and the company, not the body of the posting — a
  // word that only appears in the description is not a hit, as before.
  if (needle) {
    rows = rows.filter(
      (row) =>
        row.jobTitle.toLowerCase().includes(needle) || row.company.toLowerCase().includes(needle),
    )
  }

  const bound = (value) => (value === undefined || value === "" ? null : Number(value))

  const lower = bound(min)
  if (lower !== null && Number.isFinite(lower)) {
    rows = rows.filter((row) => row.score >= lower)
  }

  const upper = bound(max)
  if (upper !== null && Number.isFinite(upper)) {
    rows = rows.filter((row) => row.score <= upper)
  }

  const [key, direction] = String(sort).split(":")
  const sign = direction === "asc" ? 1 : -1

  rows.sort((a, b) => {
    // Score compares numerically, a date as a timestamp, anything else as text —
    // so an unrecognised sort key degrades instead of throwing.
    const left = key === "score" ? a.score : new Date(a.createdAt ?? 0).getTime()
    const right = key === "score" ? b.score : new Date(b.createdAt ?? 0).getTime()

    if (
      typeof left === "number" &&
      typeof right === "number" &&
      !Number.isNaN(left) &&
      !Number.isNaN(right)
    ) {
      return (left - right) * sign
    }

    return String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * sign
  })

  return rows
}

/** The version and its score as the dashboard card reads them. */
export function toVersion(resume) {
  return {
    id: resume.id,
    name: resume.originalName ?? "resume",
    size: resume.fileSize ?? 0,
    type: (resume.fileType ?? "").toUpperCase(),
    label: resume.label ?? "Main",
    extractionMethod: resume.extractionMethod,
    characters: resume.characters ?? 0,
    createdAt: resume.createdAt,
    score: resume.analysis?.score,
    verdict: resume.analysis?.verdict ?? "",
    // The raw analysis rides along because the server needs it back in order to
    // score a match; the page reads the mapped copy instead.
    analysis: resume.analysis ?? null,
    extractedText: resume.extractedText ?? "",
  }
}

/**
 * Newest first, which is what the dashboard shows. Dates come back out of
 * `localStorage` as ISO strings, so the comparison has to survive a missing or
 * unparseable one.
 */
export function sortVersions(resumes) {
  return [...resumes].sort((a, b) => {
    const left = new Date(a.createdAt ?? 0).getTime()
    const right = new Date(b.createdAt ?? 0).getTime()
    return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left)
  })
}