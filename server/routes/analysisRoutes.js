import { Router } from "express";

import {
  compareVersions,
  getAnalysis,
  improveCv,
  listAnalyses,
  reanalyse,
} from "../controllers/analysisController.js";
import { protect } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";

const router = Router();

router.use(protect);

/** GET /api/analysis — every version with its score. */
router.get("/", asyncHandler(listAnalyses));

/** POST /api/analysis/compare — metric-by-metric comparison of 2+ versions. */
router.post("/compare", asyncHandler(compareVersions));

/** GET /api/analysis/:resumeId — the full analysis of one version. */
router.get("/:resumeId", asyncHandler(getAnalysis));

/** POST /api/analysis/:resumeId — re-run the analysis on the stored text. */
router.post("/:resumeId", asyncHandler(reanalyse));

/** POST /api/analysis/:resumeId/improve — "Improve My CV" suggestions. */
router.post("/:resumeId/improve", asyncHandler(improveCv));

export default router;
