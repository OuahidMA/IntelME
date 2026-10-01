import { Router } from "express";

import {
  deleteResume,
  downloadResume,
  getExtractedText,
  getResume,
  listResumes,
  updateResume,
  uploadLimits,
  uploadResume,
} from "../controllers/cvController.js";
import { protect } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { uploadResumeFile } from "../middleware/uploadMiddleware.js";

const router = Router();

// Every resume route is behind the JWT check.
router.use(protect);

/** Static path declared before "/:id" so it is not captured as an id. */
router.get("/limits", asyncHandler(uploadLimits));

/** POST /api/resumes — multipart/form-data with a single `file` field. */
router.post("/", uploadResumeFile, asyncHandler(uploadResume));

/** GET /api/resumes — list every uploaded version. */
router.get("/", asyncHandler(listResumes));

/** GET /api/resumes/:id — one version plus its analysis. */
router.get("/:id", asyncHandler(getResume));

/** GET /api/resumes/:id/file — authenticated download of the original. */
router.get("/:id/file", asyncHandler(downloadResume));

/** GET /api/resumes/:id/text — the OCR output. */
router.get("/:id/text", asyncHandler(getExtractedText));

/** PATCH /api/resumes/:id — rename a version. */
router.patch("/:id", asyncHandler(updateResume));

/** DELETE /api/resumes/:id — remove the version, file and its history. */
router.delete("/:id", asyncHandler(deleteResume));

export default router;
