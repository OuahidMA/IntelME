import { Router } from "express";

import { analyseUpload, uploadLimits } from "../controllers/cvController.js";
import { protect } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { uploadResumeFile } from "../middleware/uploadMiddleware.js";

const router = Router();

// Every resume route is behind the JWT check. None of them reads or writes: the
// token establishes who is asking, and the answer goes back to the browser.
router.use(protect);

/** POST /api/resumes/analyse — multipart/form-data, single `file` field. */
router.post("/analyse", uploadResumeFile, asyncHandler(analyseUpload));

/** GET /api/resumes/limits — what the uploader should accept. */
router.get("/limits", asyncHandler(uploadLimits));

export default router;