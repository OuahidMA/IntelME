import "dotenv/config";

import cors from "cors";
import express from "express";

import { connectDB } from "./config/db.js";
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
import analysisRoutes from "./routes/analysisRoutes.js";
import authRoutes, { ping } from "./routes/authRoutes.js";
import jobRoutes from "./routes/jobRoutes.js";
import resumeRoutes from "./routes/resumeRoutes.js";

const app = express();

const PORT = Number.parseInt(process.env.PORT, 10) || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

/* ------------------------------------------------------------------ *
 * Security
 * ------------------------------------------------------------------ */

// The client origin only. A browser on any other origin is refused by the
// preflight, and `credentials: true` keeps cookies off other origins.
app.use(
  cors({
    origin: CLIENT_URL,
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

app.use(notFound);
app.use(errorHandler);

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function start() {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`[api] listening on http://localhost:${PORT}`);
      console.log(`[api] CORS restricted to ${CLIENT_URL}`);
    });
  } catch (error) {
    console.error("[api] failed to start:", error.message);
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[api] unhandled rejection:", reason);
});

process.on("SIGTERM", () => {
  console.log("[api] shutting down");
  process.exit(0);
});

start();

export default app;
