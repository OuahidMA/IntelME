/**
 * Where the API lives, in every environment.
 *
 * One variable, one place. `VITE_API_URL` is the public origin of the backend —
 * `http://localhost:5000` locally, the deployed API host in production — and
 * everything else is derived from it here. Nothing else in the client is allowed
 * to contain a URL, which is what makes "point the app at staging" a settings
 * change rather than a code change.
 *
 * ## The `/api` prefix
 *
 * `server/server.js` mounts every route under `/api`, so that prefix is part of
 * the base URL and is appended here rather than repeated on each of the ~12
 * request paths. A value that already carries it is tolerated, because the
 * natural thing to do when deploying is to paste the address bar — and
 * `https://api.example.com/api` must not quietly become `/api/api`.
 *
 * ## Reading `import.meta.env` safely
 *
 * The optional chain is load-bearing: `scripts/checkClient.mjs` imports this
 * module under plain Node, where `import.meta.env` does not exist at all. Vite
 * statically replaces the expression in a real build; in Node it evaluates to
 * `undefined` and the development default takes over.
 */

/** Mount point for every route, kept in step with `server/server.js`. */
const API_PREFIX = "/api";

/** Used when `VITE_API_URL` is absent — the `npm run dev` backend. */
const DEFAULT_API_URL = "http://localhost:5000";

/**
 * The configured origin, or an empty string.
 *
 * Written as one flat expression on purpose.
 *
 * `import.meta.env.VITE_API_URL` is a *literal* member access because that is
 * what Vite replaces at build time. Computed access (`import.meta.env[name]`)
 * still works at runtime, but it defeats the replacement — and with it the
 * bundler's ability to drop the development fallback, which is what keeps
 * `localhost` out of a production bundle entirely.
 *
 * `globalThis.process` is the second source and only fires under Node, where
 * `scripts/checkConfig.mjs` and `scripts/checkClient.mjs` drive this module
 * directly. It is reached through `globalThis` because the bare `process`
 * identifier does not exist in a browser.
 */
const CONFIGURED_URL = (
  import.meta.env?.VITE_API_URL ??
  globalThis.process?.env?.VITE_API_URL ??
  ""
).trim();

/**
 * Reduces a configured value to a bare origin: no trailing slash, and no `/api`
 * suffix we are about to add back.
 */
function toOrigin(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
}

/** The configured backend origin, e.g. `https://api.intelme.com`. */
export const API_ORIGIN = toOrigin(CONFIGURED_URL || DEFAULT_API_URL);

/** The origin every request is built from, prefix included. */
export const API_BASE_URL = `${API_ORIGIN}${API_PREFIX}`;

/**
 * True when the client is running against the local backend.
 *
 * Only for diagnostics and copy that should differ between dev and prod — the
 * request layer must never branch on it, because the whole point of
 * `VITE_API_URL` is that it does not have to.
 */
export const IS_LOCAL_API = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API_ORIGIN);

export default { API_ORIGIN, API_BASE_URL, IS_LOCAL_API };