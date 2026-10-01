import { Router } from "express";

import {
  analyseText,
  compareVersions,
  improveCv,
} from "../controllers/analysisController.js";
import { protect } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";

const router = Router();

router.use(protect);

/**
 * Three stateless calls. Each one is handed the CV data it needs, because the
 * browser is where that data lives.
 */

/** POST /api/analysis — re-run the analysis on text the browser already holds. */
router.post("/", asyncHandler(analyseText));

/** POST /api/analysis/improve — "Improve My CV" suggestions. */
router.post("/improve", asyncHandler(improveCv));

/** POST /api/analysis/compare — metric-by-metric comparison of 2+ versions. */
router.post("/compare", asyncHandler(compareVersions));

export default router;