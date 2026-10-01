import fs from "node:fs";

import { asyncHandler } from "../middleware/errorMiddleware.js";
import {
  isInsideUploadDir,
  MAX_FILE_SIZE_MB,
  removeStoredFile,
} from "../middleware/uploadMiddleware.js";
import { RESUME_STATUS } from "../models/Resume.js";
import {
  latestAnalysisFor,
  listResumeVersions,
  pruneOldAnalyses,
  removeResume,
  requireResume,
} from "../services/accountService.js";
import { analyseStoredResume, ingestResume } from "../services/documentService.js";
import { ValidationError, parseCursor, validateLabel } from "../utils/validators.js";

/**
 * POST /api/resumes
 *
 * Multipart upload of a .pdf or .docx. Stores the file inside the account
 * document, extracts its text (falling back to OCR), runs the AI analysis and
 * returns both.
 */
export const uploadResume = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ValidationError("No file was uploaded. Attach a .pdf or .docx file.");
  }

  const label = validateLabel(req.body?.label);

  let resume;

  // The file is already on disk at this point. If anything below throws we clean
  // it up here so a failed upload does not leave an orphan behind.
  try {
    resume = await ingestResume({ user: req.user, file: req.file, label });
  } catch (error) {
    removeStoredFile(req.file.path);
    throw error;
  }

  try {
    const analysis = await analyseStoredResume({ resume, user: req.user });

    // Only the newest analysis of a version is kept, so re-running replaces
    // rather than accumulates.
    await pruneOldAnalyses(req.user, resume._id, analysis._id);

    return res.status(201).json({
      success: true,
      message: "Resume uploaded and analysed.",
      resume: resume.toJSON(),
      analysis: analysis.toJSON(),
    });
  } catch (error) {
    // The CV text was recovered fine, so the document is still useful even when
    // the AI call fails — the user can retry the analysis without re-uploading.
    return res.status(error.status ?? 502).json({
      success: false,
      message: error.message,
      resume: resume.toJSON(),
      analysis: null,
      canRetry: true,
    });
  }
});

/** GET /api/resumes — every version this user has uploaded, newest first. */
export const listResumes = asyncHandler(async (req, res) => {
  const resumes = listResumeVersions(req.user, {
    limit: req.query.limit,
    cursor: parseCursor(req.query.cursor),
  });

  res.json({
    success: true,
    count: resumes.length,
    resumes: resumes.map((resume) => resume.toJSON()),
  });
});

/** GET /api/resumes/:id — one version plus its newest analysis. */
export const getResume = asyncHandler(async (req, res) => {
  const resume = requireResume(req.user, req.params.id);
  const analysis = latestAnalysisFor(req.user, resume._id);

  res.json({
    success: true,
    resume: resume.toJSON(),
    analysis: analysis ? analysis.toJSON() : null,
  });
});

/** GET /api/resumes/:id/file — authenticated download of the original file. */
export const downloadResume = asyncHandler(async (req, res) => {
  const resume = requireResume(req.user, req.params.id);

  // Defence in depth: even a corrupted DB row cannot make us read outside uploads.
  if (!isInsideUploadDir(resume.filePath) || !fs.existsSync(resume.filePath)) {
    const error = new Error("The stored file is no longer available on the server.");
    error.status = 410;
    throw error;
  }

  res.download(resume.filePath, resume.originalName);
});

/** GET /api/resumes/:id/text — the text the OCR step recovered. */
export const getExtractedText = asyncHandler(async (req, res) => {
  const resume = requireResume(req.user, req.params.id);

  res.json({
    success: true,
    originalName: resume.originalName,
    fileType: resume.fileType,
    status: resume.status,
    extractionMethod: resume.extractionMethod,
    characters: resume.extractedText?.length ?? 0,
    extractedText: resume.extractedText ?? "",
  });
});

/** PATCH /api/resumes/:id — rename a version, e.g. to "Frontend" or "Internship". */
export const updateResume = asyncHandler(async (req, res) => {
  const resume = requireResume(req.user, req.params.id);
  const label = validateLabel(req.body?.label);

  resume.label = label;
  await req.user.save();

  res.json({ success: true, message: "Version renamed.", resume: resume.toJSON() });
});

/**
 * DELETE /api/resumes/:id
 *
 * Removes the version from the account document, along with its analyses and any
 * job matches that were scored against it, and unlinks the file from disk.
 */
export const deleteResume = asyncHandler(async (req, res) => {
  const { filePath } = await removeResume(req.user, req.params.id);

  removeStoredFile(filePath);

  res.json({ success: true, message: "Resume deleted." });
});

/** GET /api/resumes/limits — what the uploader should accept, from the server. */
export const uploadLimits = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    allowedExtensions: ["pdf", "docx"],
    maxFileSizeBytes: Number.parseInt(process.env.MAX_FILE_SIZE_MB, 10) * 1024 * 1024 || 5 * 1024 * 1024,
    maxFileSizeMb: MAX_FILE_SIZE_MB,
    statusValues: Object.values(RESUME_STATUS),
  });
});
