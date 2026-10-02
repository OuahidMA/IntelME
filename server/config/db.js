import mongoose from "mongoose";

/**
 * Opens the single shared connection to MongoDB. Called once from server.js
 * before the HTTP listener starts so no request can arrive without a database.
 */
export async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is not set. Add it to server/.env before starting.");
  }

  // Surface the real reason (bad DNS, auth failure, IP allow-list) instead of a
  // silent 30s timeout.
  mongoose.connection.on("error", (error) => {
    console.error("[db] connection error:", error.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("[db] disconnected");
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
  });

  console.log(`[db] connected to ${mongoose.connection.name}`);

  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}

/**
 * Memoized `connectDB`, for module scopes that must not `await` at import time.
 *
 * A serverless runtime loads the module on a cold start and then invokes it. If
 * the module's top level awaits a network round-trip to MongoDB, the invocation
 * spends its whole budget on DNS and TLS before Express ever sees the request,
 * and Vercel reports it as a failed invocation rather than a slow one. Deferring
 * to the first request, and caching the promise so concurrent requests share one
 * handshake, keeps the cold start free of I/O.
 *
 * `mongoose.connection.readyState` is 1 for connected, so warm invocations skip
 * the work entirely. 2 (connecting) is deliberately not treated as ready: the
 * shared promise below is what callers await.
 */
let connection = null;

export function ensureDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);

  connection ??= connectDB().catch((error) => {
    // Drop the rejected promise so the next request retries instead of
    // inheriting this failure forever.
    connection = null;
    throw error;
  });

  return connection;
}

export default connectDB;
