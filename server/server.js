import "dotenv/config";

import cors from "cors";
import express from "express";

import { connectDB } from "./config/db.js";
import { allowedOrigins, createOriginChecker } from "./config/cors.js";
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
 */
const isAllowedOrigin = createOriginChecker();

/* ------------------------------------------------------------------ *
 * Security
 * ------------------------------------------------------------------ */

// Only allowlisted origins get a response the browser will accept. `credentials:
// true` keeps cookies off other origins; the app authenticates with a bearer
// token, but leaving the default in place means this stays correct if that ever
// changes.
app.use(
  cors({
    origin: isAllowedOrigin,
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

app.get("/api/health", (_req, res) => {
  res.json({ success: true, status: "ok", uptime: Math.round(process.uptime()) });
});

// Unauthenticated: proves the API and the database are both answering.
app.get("/api/ping", ping);

app.use("/api/auth", authRoutes);
app.use("/api/resumes", resumeRoutes);
app.use("/api/analysis", analysisRoutes);
app.use("/api/jobs", jobRoutes);

// Root route - shows server is running when accessed in browser
app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Server Running</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
          .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          h1 { color: #22c55e; margin: 0; }
          p { color: #666; margin-top: 0.5rem; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✓ Server is running</h1>
          <p>API is operational</p>
        </div>
      </body>
    </html>
  `);
});

app.use(notFound);
app.use(errorHandler);

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

const isServerless = Boolean(
  process.env.VERCEL ||
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.FUNCTIONS ||
    process.env.CLOUD_FUNCTION ||
    process.env.WORKER_ENV ||
    process.env.FLY_REGION === "iad" && process.env.FLY_APP_NAME // not exactly, but better to be safe
);

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

// In serverless environments, don't listen - just export the app
// Also handle DB connection more gracefully for cold starts
if (!isServerless) {
  process.on("unhandledRejection", (reason) => {
    console.error("[api] unhandled rejection:", reason);
  });

  process.on("SIGTERM", () => {
    console.log("[api] shutting down");
    process.exit(0);
  });

  start();
} else {
  // For serverless, connect DB on first request if needed
  // but we export app immediately; many platforms handle this
  // Pre-connect to reduce cold start time where possible
  connectDB().catch((error) => {
    console.error("[api] failed to connect to database:", error.message);
  });
}

export default app;
