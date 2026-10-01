import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** server/uploads — git-ignored, never served statically. */
export const UPLOAD_DIR = path.resolve(__dirname, "..", "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
    cb(null, UPLOAD_DIR);
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
