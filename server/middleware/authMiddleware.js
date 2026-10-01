import User from "../models/User.js";
import { extractBearerToken, verifyToken } from "../utils/jwt.js";

/** 401 in the same shape for every failure so nothing leaks about the token. */
function unauthorized(message = "Not authorised, no token provided.") {
  const error = new Error(message);
  error.status = 401;
  return error;
}

/**
 * Verifies the `Authorization: Bearer <jwt>` header on protected routes.
 *
 * The user document is re-read from Mongo on every request rather than trusted
 * from the token payload, so a deleted account loses access immediately and a
 * name change is reflected without waiting for the token to expire.
 */
export async function protect(req, _res, next) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      throw unauthorized();
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch (error) {
      const message =
        error.name === "TokenExpiredError"
          ? "Your session has expired, please log in again."
          : "Not authorised, invalid token.";

      throw unauthorized(message);
    }

    const user = await User.findById(payload.sub);

    if (!user) {
      throw unauthorized("This account no longer exists.");
    }

    req.user = user;
    req.token = token;

    next();
  } catch (error) {
    next(error);
  }
}

/** Attaches req.user when a valid token is present, but never blocks the route. */
export async function optionalAuth(req, _res, next) {
  const token = extractBearerToken(req);

  if (!token) return next();

  try {
    const payload = verifyToken(token);
    req.user = await User.findById(payload.sub);
  } catch {
    // An invalid token is treated as "anonymous" on optional routes.
  }

  next();
}

export default protect;
