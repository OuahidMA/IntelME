import mongoose from "mongoose";

/**
 * A resume, stored *inside* the account that uploaded it.
 *
 * This is a subdocument schema, not a model: it is mounted on `User.resumes` and
 * is never handed to `mongoose.model()`, so no `resumes` collection is ever
 * created. There is no `user` field either — the document that holds this
 * subdocument *is* the owner, which is what makes the ownership check
 * structural rather than a filter somebody can forget.
 */

/** The two formats the upload middleware accepts. */
export const RESUME_STATUS = {
  UPLOADED: "uploaded",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
};

/** How the text was recovered from the file. */
export const EXTRACTION_METHOD = {
  TEXT: "text",
  OCR: "ocr",
  HYBRID: "hybrid",
  FAILED: "failed",
};

const resumeSchema = new mongoose.Schema(
  {
    originalName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },
    fileType: {
      type: String,
      required: true,
      enum: ["pdf", "docx"],
    },
    /**
     * Authenticated download path, never a public static URL: a resume is PII
     * and must only be readable by the account that uploaded it.
     */
    fileUrl: {
      type: String,
      required: true,
    },
    /**
     * Absolute path on disk. Server-side only: the transform below deletes it on
     * the way out, which is now the only thing keeping it private — `select:
     * false` was a query-time projection and meant nothing once the resume
     * stopped being a top-level document.
     */
    filePath: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      default: 0,
    },
    /** User-facing label so several versions can be told apart (e.g. "Frontend"). */
    label: {
      type: String,
      trim: true,
      maxlength: 60,
      default: "Main",
    },
    extractedText: {
      type: String,
      default: "",
    },
    extractionMethod: {
      type: String,
      enum: Object.values(EXTRACTION_METHOD),
      default: EXTRACTION_METHOD.FAILED,
    },
    status: {
      type: String,
      enum: Object.values(RESUME_STATUS),
      default: RESUME_STATUS.UPLOADED,
    },
    error: {
      type: String,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.filePath;
        return ret;
      },
    },
  },
);

export const resumeSchemaDefinition = resumeSchema;
export default resumeSchema;
