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

export default connectDB;
