import mongoose from "mongoose";

import scoreBreakdownSchema from "./scoreBreakdown.js";

/**
 * A scored job match, stored inside the account that ran it.
 *
 * A subdocument schema, not a model: it is mounted on `User.jobs` and never
 * registered with `mongoose.model()`, so no `jobs` collection is created. As with
 * a resume, the owner is the enclosing account document and the `user` field
 * that used to carry the link is gone.
 */

/** Requirement the resume already satisfies, with the evidence we found. */
const coveredSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    evidence: { type: String, default: "" },
  },
  { _id: false },
);

/** Requirement the posting wants that the resume does not show. */
const gapSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    importance: {
      type: String,
      enum: ["required", "preferred", "nice-to-have"],
      default: "required",
    },
    hint: { type: String, default: "" },
  },
  { _id: false },
);

const experienceMatchSchema = new mongoose.Schema(
  {
    requiredYears: { type: Number, default: 0 },
    candidateYears: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["meets", "close", "below"],
      default: "meets",
    },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const educationMatchSchema = new mongoose.Schema(
  {
    required: { type: String, default: "" },
    candidate: { type: String, default: "" },
    status: {
      type: String,
      enum: ["compatible", "partial", "below", "unknown"],
      default: "unknown",
    },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const jobSchema = new mongoose.Schema(
  {
    /** The `User.resumes` subdocument this match was scored against. */
    resume: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    /** The `User.analyses` subdocument the match was derived from. */
    analysis: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    jobTitle: { type: String, default: "", trim: true },
    company: { type: String, default: "", trim: true },
    jobDescription: { type: String, required: true },

    /** Overall compatibility, 0-100. */
    score: { type: Number, required: true, min: 0, max: 100 },
    scoreBreakdown: { type: [scoreBreakdownSchema], default: [] },
    verdict: { type: String, default: "" },
    summary: { type: String, default: "" },

    matchingSkills: { type: [coveredSchema], default: [] },
    missingSkills: { type: [gapSchema], default: [] },
    matchingExperience: { type: experienceMatchSchema, default: () => ({}) },
    missingExperience: { type: [String], default: [] },
    matchingEducation: { type: educationMatchSchema, default: () => ({}) },
    matchingProjects: { type: [String], default: [] },
    missingProjects: { type: [String], default: [] },
    matchingKeywords: { type: [String], default: [] },
    missingKeywords: { type: [String], default: [] },
    matchingCertifications: { type: [String], default: [] },
    missingCertifications: { type: [String], default: [] },

    /** "+ Strong React experience" */
    strengths: { type: [String], default: [] },
    /** "- TypeScript not clearly demonstrated" */
    gaps: { type: [String], default: [] },
    recommendations: { type: [String], default: [] },

    createdAt: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        return ret;
      },
    },
  },
);

export const jobSchemaDefinition = jobSchema;
export default jobSchema;
