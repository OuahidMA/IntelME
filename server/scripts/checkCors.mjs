/**
 * Exercises the CORS allowlist without booting a server or opening a socket.
 *
 * The rules here are the ones that quietly break a deployment: a preview URL that
 * is not allowed, an origin that gets echoed back when it should not be, a
 * wildcard quietly matching more than intended. None of them fail a plain
 * `GET /api/health`, so they are asserted directly.
 *
 *   node scripts/checkCors.mjs
 */

import { allowedOrigins, buildOriginMatcher, createOriginChecker } from "../config/cors.js";

let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` -> got ${actual}, want ${expected}`}`);
}

const section = (name) => console.log(`\n${name}`);

section("Defaults — local Vite must work with no configuration at all");

const fallback = createOriginChecker({});
check("localhost:5173 is allowed", fallback("http://localhost:5173"), true);
check("127.0.0.1:5173 is allowed", fallback("http://127.0.0.1:5173"), true);
check("an unrelated origin is refused", fallback("https://evil.example"), false);
check("a request with no Origin header is allowed", fallback(undefined), true);
check("a trailing slash is tolerated", fallback("http://localhost:5173/"), true);
check("a lookalike port is not localhost", fallback("http://localhost:5174"), false);

section("CLIENT_URL is still honoured, so an existing deployment keeps working");

const legacy = createOriginChecker({ CLIENT_URL: "https://old.example.com" });
check("the legacy singular variable is read", legacy("https://old.example.com"), true);
check(
  "CLIENT_ORIGIN takes precedence over CLIENT_URL",
  createOriginChecker({ CLIENT_URL: "https://old.example.com", CLIENT_ORIGIN: "https://new.example.com" })(
    "https://new.example.com",
  ),
  true,
);
check(
  "and the superseded one is dropped",
  createOriginChecker({ CLIENT_URL: "https://old.example.com", CLIENT_ORIGIN: "https://new.example.com" })(
    "https://old.example.com",
  ),
  false,
);

section("Several origins at once");

const production = createOriginChecker({
  CLIENT_ORIGIN: "https://intelme.app, https://www.intelme.app/ ,",
});
check("the first origin is allowed", production("https://intelme.app"), true);
check("the second is allowed, trailing slash trimmed", production("https://www.intelme.app"), true);
check("local dev still works alongside production", production("http://localhost:5173"), true);
check("an unlisted sibling subdomain is refused", production("https://evil.intelme.app"), false);
check("a lookalike host is refused", production("https://intelme.app.attacker.com"), false);

section("A single * covers one label — the Vercel case");

const vercel = createOriginChecker({ CLIENT_ORIGIN: "https://*.vercel.app" });
check("a production deployment is allowed", vercel("https://intelme.vercel.app"), true);
check("a preview deployment is allowed", vercel("https://intelme-abc123.vercel.app"), true);
check(
  "a sibling Vercel project is allowed too (the documented tradeoff)",
  vercel("https://someone-else.vercel.app"),
  true,
);
check("a deeper subdomain is refused", vercel("https://a.b.vercel.app"), false);
check("a suffix attack is refused", vercel("https://intelme.vercel.app.attacker.com"), false);
check("the scheme still has to match", vercel("http://intelme.vercel.app"), false);

section("A * must not smuggle in a prefix");

const prefix = buildOriginMatcher("https://intelme*.example.com");
check("the intended subdomain matches", prefix("https://intelme-1.example.com"), true);
check("an unrelated host does not", prefix("https://other.example.com"), false);
check("a suffix attack does not", prefix("https://intelme-evil.example.com.attacker.com"), false);

section("An over-broad pattern is refused rather than trusted");

// Two wildcards would compile into a pattern broad enough to trust the whole
// internet, which is never what was meant. Ignoring it loudly beats honouring it.
const twoWildcards = buildOriginMatcher("https://*.*.example.com");
check("a double-wildcard entry never matches", twoWildcards("https://a.b.example.com"), false);

section("Malformed configuration");

check("an empty CLIENT_ORIGIN still allows localhost", createOriginChecker({ CLIENT_ORIGIN: "" })("http://localhost:5173"), true);
check("an empty allowlist entry matches nothing", buildOriginMatcher("")("http://localhost:5173"), false);
check(
  "blank entries in the list are skipped, not fatal",
  allowedOrigins({ CLIENT_ORIGIN: " , ,https://ok.example" }).includes("https://ok.example"),
  true,
);
check(
  "duplicate entries collapse",
  new Set(allowedOrigins({ CLIENT_ORIGIN: "http://localhost:5173" })).size,
  allowedOrigins({ CLIENT_ORIGIN: "http://localhost:5173" }).length,
);

console.log(failures === 0 ? "\nAll CORS checks passed." : `\n${failures} CORS check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);