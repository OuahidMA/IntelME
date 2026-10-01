import { Router } from "express";

import { createMatch } from "../controllers/jobController.js";
import { protect } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";

const router = Router();

router.use(protect);

/**
 * The only job route. There is no history endpoint because there is no history
 * on the server: the match is scored, returned, and kept in the browser that
 * asked for it.
 */
router.post("/match", asyncHandler(createMatch));

export default router;