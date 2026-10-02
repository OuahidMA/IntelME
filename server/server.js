import "dotenv/config";

import cors from "cors";
import express from "express";

import { connectDB, ensureDB } from "./config/db.js";
import { allowedOrigins, createOriginPattern } from "./config/cors.js";
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
import analysisRoutes from "./routes/analysisRoutes.js";
import authRoutes, { ping } from "./routes/authRoutes.js";
import jobRoutes from "./routes/jobRoutes.js";
import resumeRoutes from "./routes/resumeRoutes.js";

const app = express();

const PORT = Number.parseInt(process.env.PORT, 10) || 5000;

/**
 * Which browser origins are answered, from `CLIENT_ORIGIN` / `CLIENT_URL`.
 *
 * Local Vite is always included so that configuring a production origin cannot
 * break `npm run dev`; a Vercel preview can be allowed with a single `*`, e.g.
 * `https://*.vercel.app`. The rules and the reasoning behind them are in
 * `config/cors.js`.
 *
 * This has to be a pattern and not a predicate: `cors` calls a function `origin`
 * as an async delegate, so passing a synchronous one leaves every request without
 * a response.
 */
const allowedOrigin = createOriginPattern();

/* ------------------------------------------------------------------ *
 * Security
 * ------------------------------------------------------------------ */

// Only allowlisted origins get a response the browser will accept. `credentials:
// true` keeps cookies off other origins; the app authenticates with a bearer
// token, but leaving the default in place means this stays correct if that ever
// changes. The pattern reflects an allowed origin and omits the header for a
// refused one.
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// Job descriptions and resume text are the only bodies we accept; 1 MB is far
// more than any of them needs and keeps a malicious payload cheap to reject.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.disable("x-powered-by");

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

// The landing page answers from the module itself, so it stays up even when the
// database is unreachable — which is the whole point of using it to check
// whether the deployment is alive.
app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>intelme api</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
        background: #0b0d10;
        color: #e6e8eb;
      }
      main { text-align: center; padding: 2rem; }
      h1 { margin: 0 0 .5rem; font-size: 1.5rem; font-weight: 600; }
      h1::before { content: "\\2713"; color: #3ddc84; margin-right: .5rem; }
      p { margin: 0; color: #8b9299; }
    </style>
  </head>
  <body>
    <main>
      <h1>Server is running</h1>
      <p>intelme api &middot; <code>/api/health</code> &middot; <code>/api/ping</code></p>
    </main>
  </body>
</html>`);
});

// Every route below reads or writes MongoDB. Opening the connection here, on
// the first request, is what keeps a cold start from timing out before Express
// is even invoked. `ensureDB` caches its promise, so the requests that arrive
// while the handshake is in flight all await the same one.
app.use(async (_req, res, next) => {
  try {
    await ensureDB();
    next();
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ success: true, status: "ok", uptime: Math.round(process.uptime()) });
});

// Unauthenticated: proves the API and the database are both answering.
app.get("/api/ping", ping);

app.use("/api/auth", authRoutes);
app.use("/api/resumes", resumeRoutes);
app.use("/api/analysis", analysisRoutes);
app.use("/api/jobs", jobRoutes);

app.use(notFound);
app.use(errorHandler);

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

/**
 * Opens the connection, then listens.
 *
 * The order matters locally: binding the port first would accept a request
 * before there is a database behind it.
 */
async function start() {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`[api] listening on http://localhost:${PORT}`);
      console.log(`[api] CORS allows: ${allowedOrigins().join(", ")}`);
    });
  } catch (error) {
    console.error("[api] failed to start:", error.message);
    process.exit(1);
  }
}

/**
 * Whether this process owns its HTTP server.
 *
 * Under a serverless runtime the platform invokes the exported app and
 * terminates the sandbox afterwards, so binding a port both fails and hides the
 * real error. `VERCEL` is the flag Vercel sets on every function; the others
 * cover the other runtimes an Express app of this shape tends to land on.
 * `VERCEL_ENV` is checked too because it is set during the build, when binding a
 * port is equally wrong.
 */
const isServerless = Boolean(
  process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME,
);

process.on("unhandledRejection", (reason) => {
  console.error("[api] unhandled rejection:", reason);
});

process.on("SIGTERM", () => {
  console.log("[api] shutting down");
  process.exit(0);
});

if (isServerless) {
  // Nothing to start. The first request opens the connection through the
  // `ensureDB` middleware above.
  console.log("[api] serverless mode: exporting app, deferring database connect");
} else {
  start();
}

export default app;
