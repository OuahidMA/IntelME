import { ValidationError } from "../utils/validators.js";

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Terminal 404 for any request that matched no route. */
export function notFound(req, _res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  next(error);
}

/**
 * Single place where an error becomes a response.
 *
 * Only messages we raised ourselves are sent verbatim. Anything else — a Mongo
 * error, a parser crash, a bug — is logged server-side and reduced to a generic
 * 500 so internals never reach the client.
 */
export function errorHandler(error, _req, res, _next) {
  const status = error.status ?? error.statusCode ?? 500;

  let message = error.message ?? "Something went wrong.";
  let details = error.details;

  // Translate the driver's duplicate-key error into a friendly conflict.
  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "An account with that email already exists.",
      errors: { email: "Email is already registered." },
    });
  }

  // Our own validation errors, checked by identity rather than by name: this
  // class is also called `ValidationError`, so testing `error.name` would send
  // every message we wrote down the Mongoose branch below and replace it with a
  // generic one, losing both the wording and the per-field details.
  if (error instanceof ValidationError) {
    const fields = error.details ?? {};

    return res.status(400).json({
      success: false,
      message: error.message,
      ...(Object.keys(fields).length > 0 ? { errors: fields } : {}),
    });
  }

  // Mongoose schema validation, e.g. a field that slipped past our validators.
  if (error.name === "ValidationError") {
    details = Object.fromEntries(
      Object.entries(error.errors ?? {}).map(([field, issue]) => [
        field,
        issue.message,
      ]),
    );

    return res.status(400).json({
      success: false,
      message: "Please fix the highlighted fields.",
      errors: details,
    });
  }

  // Malformed JSON body from express.json().
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Request body is not valid JSON.",
    });
  }

  // Multer: file too large / wrong type.
  if (error.name === "MulterError") {
    const tooLarge = error.code === "LIMIT_FILE_SIZE";
    return res.status(400).json({
      success: false,
      message: tooLarge
        ? "That file is too large."
        : `Upload failed: ${error.message}.`,
    });
  }

  if (status >= 500) {
    console.error("[error]", error);

    if (process.env.NODE_ENV === "production") {
      message = "Something went wrong on our side.";
      details = undefined;
    }
  }

  res.status(status).json({
    success: false,
    message,
    ...(details ? { errors: details } : {}),
    ...(process.env.NODE_ENV === "development" && status >= 500
      ? { stack: error.stack }
      : {}),
  });
}

export default { asyncHandler, notFound, errorHandler };
