/**
 * Which browser origins the API will answer.
 *
 * CORS is the one piece of configuration that has to work across three
 * environments — a Vite dev server, a production domain, and a preview
 * deployment per branch — so it lives here on its own rather than inline in
 * `server.js`: the matching rules are fiddly enough to deserve being read in
 * isolation, and separating them also means they can be tested without booting a
 * server and opening a socket.
 */

/** Local Vite, always. See the note on `buildOriginMatcher`. */
export const LOCAL_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

/**
 * Reads a list out of the environment.
 *
 * `CLIENT_ORIGIN` is the documented name. `CLIENT_URL` is still honoured as a
 * fallback so an existing deployment that set the singular name keeps working
 * without being edited first.
 */
function configuredOrigins(env = process.env) {
  return (env.CLIENT_ORIGIN || env.CLIENT_URL || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** Escapes the regex metacharacters in an allowlist entry. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * An allowlist entry as a predicate over origins.
 *
 * `*` matches exactly one dot-separated label, so `https://*.vercel.app` covers
 * `intelme-abc123.vercel.app` and every sibling preview deployment without
 * reaching `evil.vercel.app.attacker.com` or a deeper subdomain. Anything with
 * two wildcards is rejected outright rather than silently allowed — a pattern
 * that broad is far more likely a mistake than an intention.
 */
export function buildOriginMatcher(allowed) {
  const entry = String(allowed ?? "").trim().replace(/\/+$/, "");

  if (!entry) return () => false;

  if (!entry.includes("*")) return (origin) => origin === entry;

  const wildcards = entry.split("*").length - 1;

  if (wildcards > 1) {
    console.warn(`[cors] ignoring "${entry}": only one "*" is supported`);
    return () => false;
  }

  const pattern = new RegExp(`^${entry.split("*").map(escapeRegExp).join("[^.]*")}$`);

  return (origin) => pattern.test(origin);
}

/**
 * The list of origins this deployment will answer, de-duplicated.
 *
 * Local Vite is included unconditionally so that setting a production origin
 * cannot quietly break `npm run dev` on the machine doing the deploying. That is
 * not a hole worth worrying about: a browser on a hostile page cannot forge
 * `Origin`, so the only requests it admits are from a developer already running
 * the client locally, and every protected route still needs a bearer token no
 * matter who sent it.
 */
export function allowedOrigins(env = process.env) {
  return [...new Set([...LOCAL_ORIGINS, ...configuredOrigins(env)])];
}

/**
 * A predicate suitable for `cors({ origin })`.
 *
 * Returning `false` makes `cors` omit the header entirely rather than echoing a
 * refused origin back — which is the property the browser actually enforces, and
 * the one the HTTP suite asserts.
 *
 * A missing `Origin` header is allowed: same-origin, `curl` and server-to-server
 * calls do not send one, and they are not subject to CORS, so refusing them would
 * break the health check and the CLI suites for no security benefit.
 */
export function createOriginChecker(env = process.env) {
  const matchers = allowedOrigins(env).map(buildOriginMatcher);

  return (origin) => {
    if (!origin) return true;

    const candidate = origin.replace(/\/+$/, "");
    return matchers.some((matches) => matches(candidate));
  };
}

export default createOriginChecker;