import { Router } from "express";

import {
  clearMatches,
  createMatch,
  deleteMatch,
  getMatch,
  listMatches,
} from "../controllers/jobController.js";
import { protect } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";

const router = Router();

router.use(protect);

/** POST /api/jobs/match — score a pasted job description against a CV. */
router.post("/match", asyncHandler(createMatch));

/** GET /api/jobs — "My job matches", sortable and filterable. */
router.get("/", asyncHandler(listMatches));

/** DELETE /api/jobs — clear the whole history. */
router.delete("/", asyncHandler(clearMatches));

/** GET /api/jobs/:id — one match in full. */
router.get("/:id", asyncHandler(getMatch));

/** DELETE /api/jobs/:id — remove one entry. */
router.delete("/:id", asyncHandler(deleteMatch));

export default router;
