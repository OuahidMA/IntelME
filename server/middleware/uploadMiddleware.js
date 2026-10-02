import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isServerless = Boolean(
  process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME,
);

/**
 * server/uploads — git-ignored, never served statically.
 *
 * On a serverless runtime the bundle's own directory is mounted read-only, so
 * creating a folder beside the code fails with EROFS. The OS temp directory is
 * the writable path such a runtime provides (`/tmp` on Vercel), and it is
 * per-instance — which is the right lifetime here anyway, because an upload is
 * parsed within the request that received it and deleted straight after (see
 * `removeStoredFile`).
 */
export const UPLOAD_DIR = isServerless
  ? path.join(os.tmpdir(), "uploads")
  : path.resolve(__dirname, "..", "uploads");

export const MAX_FILE_SIZE_MB = Number.parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 5;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/** The only extensions the API accepts. */
export const ALLOWED_EXTENSIONS = ["pdf", "docx"];

/**
 * Browsers report wildly different MIME types for .docx (and some send
 * `application/octet-stream` for anything), so the extension is the primary
 * check and the MIME type is only used to reject obviously wrong binaries.
 */
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip", // a .docx is a zip container
  "application/octet-stream",
  "application/msword",
]);

export function getExtension(filename) {
  return path.extname(String(filename ?? "")).toLowerCase().replace(".", "");
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    // Created here rather than at import time. A module-scope mkdirSync looks
    // harmless but runs on every cold start, so on a read-only bundle it throws
    // before Express ever sees a request and takes the whole API down with it.
    fs.mkdir(UPLOAD_DIR, { recursive: true }, (error) => cb(error, UPLOAD_DIR));
  },
  filename(_req, file, cb) {
    // The stored name is generated, never derived from the client's filename:
    // that removes any path-traversal or extension-spoofing vector.
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
    cb(null, `${unique}.${getExtension(file.originalname) || "bin"}`);
  },
});

function fileFilter(_req, file, cb) {
  const extension = getExtension(file.originalname);

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    const error = new Error(
      `Only ${ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(" and ")} files are accepted.`,
    );
    error.status = 400;
    return cb(error, false);
  }

  if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
    const error = new Error("That file type is not supported.");
    error.status = 400;
    return cb(error, false);
  }

  cb(null, true);
}

export const uploadResumeFile = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
}).single("file");

/** Removes a stored file, ignoring the case where it is already gone. */
export function removeStoredFile(filePath) {
  if (!filePath) return;

  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("[upload] failed to delete", filePath, error.message);
    }
  }
}

/** Guards against a stored path that somehow escaped the upload directory. */
export function isInsideUploadDir(filePath) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(UPLOAD_DIR) + path.sep;

  return resolved.startsWith(root);
}

export default uploadResumeFile;
