import jwt from "jsonwebtoken";

/**
 * The secret is only ever read from the process environment. It is never sent to
 * the browser and never returned in a response body — only the resulting signed
 * token is.
 */
function getSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET is missing or too short. Set a random value of 32+ characters in server/.env.",
    );
  }

  return secret;
}

/**
 * Signs an access token for a user document. Only the id is embedded so that a
 * token stays small and never carries the password hash.
 */
export function signToken(user, { expiresIn } = {}) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email },
    getSecret(),
    { expiresIn: expiresIn ?? process.env.JWT_EXPIRES_IN ?? "7d" },
  );
}

/** Throws if the token is missing, tampered with or expired. */
export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

/** Pulls the raw token out of an `Authorization: Bearer <token>` header. */
export function extractBearerToken(req) {
  const header = req.headers?.authorization ?? "";

  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();

  return token.length > 0 ? token : null;
}

export default { signToken, verifyToken, extractBearerToken };
