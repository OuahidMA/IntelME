/**
 * Proves the API base URL is derived correctly from `VITE_API_URL`.
 *
 * This is the check that matters most at deploy time, because the failure it
 * guards against is silent and total: the app builds fine, loads fine, and every
 * single request 404s. It happened here once — the fallback default carried the
 * `/api` prefix while the documented value did not, so following the documented
 * instructions produced requests to `/auth/login` instead of `/api/auth/login`.
 *
 * Each case re-imports the module with a cache-busting query, because the
 * configuration is resolved once at module scope — which is also how Vite behaves
 * in a real build.
 *
 *   node scripts/checkConfig.mjs
 */

import path from "node:path"
import { pathToFileURL } from "node:url"

const MODULE = pathToFileURL(path.resolve(import.meta.dirname, "../src/Services/config.js")).href

let failures = 0

function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` -> got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`)
}

const section = (name) => console.log(`\n${name}`)

/** Loads the module as if `VITE_API_URL` had the given value. */
async function loadWith(value) {
  if (value === null) delete process.env.VITE_API_URL
  else process.env.VITE_API_URL = value

  return import(`${MODULE}?v=${encodeURIComponent(String(value))}`)
}

section("The documented value")

{
  const config = await loadWith("http://localhost:5000")
  check("the documented value yields the API root", config.API_BASE_URL, "http://localhost:5000/api")
  check("the origin is reported on its own", config.API_ORIGIN, "http://localhost:5000")
  check("it is recognised as local", config.IS_LOCAL_API, true)
}

section("With no variable set")

{
  const config = await loadWith(null)
  check("development default is the local API", config.API_BASE_URL, "http://localhost:5000/api")
}

section("Production")

{
  const config = await loadWith("https://api.intelme.com")
  check("the production origin is used", config.API_BASE_URL, "https://api.intelme.com/api")
  check("it is not mistaken for local", config.IS_LOCAL_API, false)
}

section("Values a human will actually paste")

{
  // The address bar of a working request. Silently becoming `/api/api` would 404
  // every route with a message that points nowhere near the real cause.
  const withPrefix = await loadWith("https://api.intelme.com/api")
  check("a value that already ends in /api is not doubled", withPrefix.API_BASE_URL, "https://api.intelme.com/api")

  const trailingSlash = await loadWith("https://api.intelme.com/")
  check("a trailing slash is trimmed", trailingSlash.API_BASE_URL, "https://api.intelme.com/api")

  const padded = await loadWith("  https://api.intelme.com  ")
  check("surrounding whitespace is trimmed", padded.API_BASE_URL, "https://api.intelme.com/api")

  const empty = await loadWith("")
  check("an empty value falls back to the default", empty.API_BASE_URL, "http://localhost:5000/api")

  const blank = await loadWith("   ")
  check("a whitespace-only value falls back to the default", blank.API_BASE_URL, "http://localhost:5000/api")
}

section("Self-hosted hosts that include a port")

{
  const config = await loadWith("http://192.168.1.50:8080")
  check("host and port are both kept", config.API_BASE_URL, "http://192.168.1.50:8080/api")
  check("a LAN address is not reported as localhost", config.IS_LOCAL_API, false)
}

console.log(failures === 0 ? "\nAll config checks passed." : `\n${failures} config check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)