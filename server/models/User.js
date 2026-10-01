import mongoose from "mongoose";

import analysisSchema from "./Analysis.js";
import jobSchema from "./Job.js";
import resumeSchema from "./Resume.js";

/**
 * The account document, and the only document in the database.
 *
 * `users` is the single collection. A CV, its analyses and every job match are
 * embedded as subdocuments of the account that owns them rather than living in
 * collections of their own, which means:
 *
 *   - registering a user cannot create anything but a `users` document;
 *   - ownership is structural — a resume is only ever reachable through the
 *     account document that holds it, so there is no `user` field to forget when
 *     a query is written;
 *   - deleting an account removes everything that belonged to it in one write.
 *
 * The cost is that an account document must stay under MongoDB's 16 MB document
 * limit, and that reads of the history are served from the account document
 * instead of by an indexed query. Both are fine at the scale this app works at.
 */

/**
 * The `password` field is `select: false`, so it is never attached to a query
 * result unless a query explicitly asks for it with `+password`. Combined with
 * the toJSON transform below, the hash cannot leak through an API response by
 * accident.
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [80, "Name must be 80 characters or fewer"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      lowercase: true,
      trim: true,
      maxlength: [160, "Email is too long"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      select: false,
    },
    /**
     * Every CV version this account has uploaded. The array is append-only in
     * upload order, so "newest first" is applied when it is read rather than by
     * keeping the stored order itself in flux.
     */
    resumes: {
      type: [resumeSchema],
      default: () => [],
    },
    /**
     * One entry per analysis run, each pointing at the resume it came from.
     * Re-running an analysis appends a new one and the old one is pruned, so
     * there is at most one live analysis per version.
     */
    analyses: {
      type: [analysisSchema],
      default: () => [],
    },
    /** The scored job match history, in the order it was produced. */
    jobs: {
      type: [jobSchema],
      default: () => [],
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  {
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        // Only the account fields are serialised. The embedded arrays hold PII
        // (extracted CV text, absolute paths on disk) and are served by the
        // resume, analysis and job endpoints instead of riding along on every
        // /auth/me and /auth/login response.
        return {
          id: ret._id.toString(),
          name: ret.name,
          email: ret.email,
          createdAt: ret.createdAt,
        };
      },
    },
  },
);

/**
 * Uniqueness is declared here rather than as `unique: true` on the field,
 * because only this form can attach a collation — and without collation
 * MongoDB would treat Bob@x.com and bob@x.com as two different accounts.
 * Declaring both makes Mongoose drop this one and fall back to a plain unique
 * index, silently losing the guarantee.
 */
userSchema.index(
  { email: 1 },
  { unique: true, collation: { locale: "en", strength: 2 }, name: "email_unique_ci" },
);

export const User = mongoose.model("User", userSchema);
export default User;
