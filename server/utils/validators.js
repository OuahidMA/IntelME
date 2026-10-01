import mongoose from "mongoose";

/**
 * Input validation. Every controller runs its payload through one of these
 * helpers before touching the database so bad input fails fast with a 400 and a
 * field-level message, and so nothing unexpected is ever persisted.
 */

export const MAX_PASSWORD_LENGTH = 72; // bcrypt hashes at most 72 bytes

/** Error carrying an HTTP status, picked up by the error middleware. */
export class ValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
    this.details = details;
  }
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normaliseEmail(value) {
  return asString(value).toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(asString(value));
}

export function assertObjectId(value, field = "id") {
  if (!isValidObjectId(value)) {
    throw new ValidationError(`Invalid ${field}.`);
  }

  return asString(value);
}

/** Collapses runs of whitespace so a paste with blank lines still reads well. */
export function collapseWhitespace(value) {
  return asString(value).replace(/\s+/g, " ");
}

export function validateRegister({ name, email, password } = {}) {
  const errors = {};
  const cleanName = asString(name);
  const cleanEmail = normaliseEmail(email);
  const cleanPassword = typeof password === "string" ? password : "";

  if (cleanName.length < 2) errors.name = "Name must be at least 2 characters.";
  if (cleanName.length > 80) errors.name = "Name must be 80 characters or fewer.";
  if (!isValidEmail(cleanEmail)) errors.email = "Enter a valid email address.";
  if (cleanPassword.length < 8) errors.password = "Password must be at least 8 characters.";
  if (cleanPassword.length > MAX_PASSWORD_LENGTH) {
    errors.password = `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Please fix the highlighted fields.", errors);
  }

  // The name is stored, never trimmed of meaningful inner spaces.
  return { name: cleanName, email: cleanEmail, password: cleanPassword };
}

export function validateLogin({ email, password } = {}) {
  const cleanEmail = normaliseEmail(email);
  const cleanPassword = typeof password === "string" ? password : "";

  // Deliberately vague: we do not reveal whether the email exists.
  if (!isValidEmail(cleanEmail) || cleanPassword.length === 0) {
    throw new ValidationError("Email and password are required.");
  }

  return { email: cleanEmail, password: cleanPassword };
}

export function validateProfileUpdate(payload = {}) {
  const update = {};
  const errors = {};

  if (payload.name !== undefined) {
    const cleanName = asString(payload.name);
    if (cleanName.length < 2 || cleanName.length > 80) {
      errors.name = "Name must be between 2 and 80 characters.";
    } else {
      update.name = cleanName;
    }
  }

  if (payload.email !== undefined) {
    const cleanEmail = normaliseEmail(payload.email);
    if (!isValidEmail(cleanEmail)) {
      errors.email = "Enter a valid email address.";
    } else {
      update.email = cleanEmail;
    }
  }

  // Email and password changes are intentionally not supported here: both need
  // the current password to be supplied first, which would be a separate flow.
  if (payload.password !== undefined) {
    errors.password = "Password changes are not available from this endpoint.";
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Please fix the highlighted fields.", errors);
  }

  if (Object.keys(update).length === 0) {
    throw new ValidationError("Nothing to update.");
  }

  return update;
}

export function validatePasswordChange({ currentPassword, newPassword } = {}) {
  const errors = {};

  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    errors.currentPassword = "Current password is required.";
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    errors.newPassword = "New password must be at least 8 characters.";
  }
  if (typeof newPassword === "string" && newPassword.length > MAX_PASSWORD_LENGTH) {
    errors.newPassword = `New password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError("Please fix the highlighted fields.", errors);
  }

  return { currentPassword, newPassword };
}

export function validateLabel(value) {
  const label = asString(value);

  if (!label) return "Main";
  if (label.length > 60) {
    throw new ValidationError("Version label must be 60 characters or fewer.");
  }

  return label;
}

export const MIN_JOB_DESCRIPTION_LENGTH = 80;
export const MAX_JOB_DESCRIPTION_LENGTH = 12_000;

export function validateJobDescription({ jobDescription, jobTitle, company } = {}) {
  const description = asString(jobDescription);

  if (description.length < MIN_JOB_DESCRIPTION_LENGTH) {
    throw new ValidationError(
      `Paste at least ${MIN_JOB_DESCRIPTION_LENGTH} characters of job description.`,
    );
  }
  if (description.length > MAX_JOB_DESCRIPTION_LENGTH) {
    throw new ValidationError(
      `Job description must be ${MAX_JOB_DESCRIPTION_LENGTH} characters or fewer.`,
    );
  }

  return {
    jobDescription: description,
    jobTitle: asString(jobTitle).slice(0, 120),
    company: asString(company).slice(0, 120),
  };
}

/** Cursor for "My job matches", either a date or an ObjectId. */
export function parseCursor(value) {
  const raw = asString(value);
  if (!raw) return null;

  if (isValidObjectId(raw)) return { _id: { $lt: raw } };
  if (!Number.isNaN(Date.parse(raw))) return { createdAt: { $lt: new Date(raw) } };

  return null;
}

/** Whitelisted sort keys — never interpolate a raw query string into Mongo. */
export function parseSort(sort, allowed, fallback) {
  const raw = asString(sort);
  const [field, direction] = raw.split(":");
  const key = allowed[field];

  if (!key) return fallback;

  return { [key]: direction === "asc" ? 1 : -1 };
}

/** `?min=60&max=90` -> { $gte: 60, $lte: 90 }, ignoring absent bounds. */
export function parseScoreRange(query = {}) {
  const filter = {};
  const min = Number.parseFloat(query.min);
  const max = Number.parseFloat(query.max);

  if (!Number.isNaN(min)) filter.$gte = min;
  if (!Number.isNaN(max)) filter.$lte = max;

  return Object.keys(filter).length > 0 ? filter : null;
}
