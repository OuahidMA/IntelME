import bcrypt from "bcryptjs";

import User from "../models/User.js";
import { asyncHandler } from "../middleware/errorMiddleware.js";
import { removeStoredFile } from "../middleware/uploadMiddleware.js";
import { signToken } from "../utils/jwt.js";
import {
  ValidationError,
  validateLogin,
  validatePasswordChange,
  validateProfileUpdate,
  validateRegister,
} from "../utils/validators.js";

/** Work factor for bcrypt. 12 rounds is a good 2020s default on modern CPUs. */
const SALT_ROUNDS = 12;

/** The exact message required for any failed credential check. */
const BAD_CREDENTIALS = "Email or password incorrect";

/**
 * POST /api/auth/register
 *
 * Creates the account, stores only a bcrypt hash of the password, and returns a
 * signed JWT. The plaintext password is never written anywhere.
 *
 * This is the only write that creates anything in the database: one document in
 * the `users` collection, with its resume, analysis and job-match arrays empty.
 * There is no second collection to initialise, and nothing else to cascade when
 * the account is later deleted.
 */
export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = validateRegister(req.body);

  const existing = await User.findOne({ email }).select("_id");

  if (existing) {
    const error = new Error("An account with that email already exists.");
    error.status = 409;
    error.details = { email: "Email is already registered." };
    throw error;
  }

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await User.create({ name, email, password: hashed });

  const token = signToken(user);

  res.status(201).json({
    success: true,
    message: "Account created.",
    token,
    user: user.toJSON(),
  });
});

/**
 * POST /api/auth/login
 *
 * The same "Email or password incorrect" message is returned whether the email
 * is unknown or the password is wrong, so the endpoint cannot be used to
 * enumerate registered addresses.
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = validateLogin(req.body);

  // `+password` opts back into the field that is `select: false` on the schema.
  const user = await User.findOne({ email }).select("+password");

  if (!user) {
    // Compare against a dummy hash anyway so a missing account and a wrong
    // password take a similar amount of time.
    await bcrypt.compare(password, "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");
    return res.status(401).json({ success: false, message: BAD_CREDENTIALS });
  }

  const matches = await bcrypt.compare(password, user.password);

  if (!matches) {
    return res.status(401).json({ success: false, message: BAD_CREDENTIALS });
  }

  const token = signToken(user);

  res.json({
    success: true,
    message: "Logged in.",
    token,
    user: user.toJSON(),
  });
});

/** GET /api/auth/me — the client calls this on boot to validate a stored token. */
export const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user.toJSON() });
});

/** PATCH /api/auth/me — update name and/or email. */
export const updateMe = asyncHandler(async (req, res) => {
  const update = validateProfileUpdate(req.body);

  if (update.email && update.email !== req.user.email) {
    const taken = await User.findOne({ email: update.email }).select("_id");

    if (taken) {
      const error = new Error("An account with that email already exists.");
      error.status = 409;
      error.details = { email: "Email is already registered." };
      throw error;
    }
  }

  // Assign field by field: `findByIdAndUpdate` with an arbitrary object would let
  // a caller try to set `password` or `role`.
  Object.assign(req.user, update);
  await req.user.save();

  res.json({ success: true, message: "Profile updated.", user: req.user.toJSON() });
});

/** PATCH /api/auth/password — re-hash a new password after verifying the old one. */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = validatePasswordChange(req.body);

  const user = await User.findById(req.user._id).select("+password");

  const matches = await bcrypt.compare(currentPassword, user.password);

  if (!matches) {
    // Not BAD_CREDENTIALS: that wording is the login contract, and it talks
    // about an email that plays no part in changing a password.
    const error = new ValidationError("Your current password is not correct.");
    error.status = 400;
    throw error;
  }

  user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await user.save();

  res.json({ success: true, message: "Password updated." });
});

/**
 * DELETE /api/auth/me
 *
 * Removes the account. Resumes, analyses and job matches are subdocuments of
 * that account, so they go with it in a single delete — there is no cascade to
 * run and no row left pointing at a user that no longer exists. Only the files
 * on disk are still separate, and each is unlinked with the resume it belonged
 * to.
 */
export const deleteMe = asyncHandler(async (req, res) => {
  const files = req.user.resumes.map((resume) => resume.filePath).filter(Boolean);

  await req.user.deleteOne();

  for (const filePath of files) {
    removeStoredFile(filePath);
  }

  res.json({ success: true, message: "Account deleted." });
});
