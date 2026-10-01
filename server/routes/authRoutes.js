import { Router } from "express";

import {
  changePassword,
  deleteMe,
  getMe,
  login,
  register,
  updateMe,
} from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import User from "../models/User.js";

const router = Router();

/** POST /api/auth/register — create an account (public). */
router.post("/register", asyncHandler(register));

/** POST /api/auth/login — exchange credentials for a JWT (public). */
router.post("/login", asyncHandler(login));

/** Everything below verifies the JWT on every request. */
router.use(protect);

router.get("/me", asyncHandler(getMe));
router.patch("/me", asyncHandler(updateMe));
router.patch("/me/password", asyncHandler(changePassword));
router.delete("/me", asyncHandler(deleteMe));

/** Liveness probe that does not require a token. */
export const ping = asyncHandler(async (_req, res) => {
  const users = await User.estimatedDocumentCount();

  res.json({
    success: true,
    message: "intelme API",
    users,
    uptime: Math.round(process.uptime()),
  });
});

export default router;
