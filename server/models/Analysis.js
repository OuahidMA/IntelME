import mongoose from "mongoose";

import scoreBreakdownSchema from "./scoreBreakdown.js";

/**
 * An analysis, stored inside the account whose resume it was produced from.
 *
 * A subdocument schema, not a model: it is mounted on `User.analyses` and never
 * registered with `mongoose.model()`, so no `analyses` collection is created.
 *
 * The owner is implicit — the enclosing account document. `resume` is still an
 * ObjectId, because an analysis is about one specific version of a CV while the
 * same account may hold several.
 */

const profileSchema = new mongoose.Schema(
  {
    fullName: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    location: { type: String, default: "" },
    summary: { type: String, default: "" },
    links: { type: [String], default: [] },
  },
  { _id: false },
);

const skillSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, default: "Other", trim: true },
    level: { type: String, default: "Intermediate", trim: true },
  },
  { _id: false },
);

const experienceSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    company: { type: String, default: "" },
    location: { type: String, default: "" },
    startDate: { type: String, default: "" },
    endDate: { type: String, default: "" },
    current: { type: Boolean, default: false },
    durationMonths: { type: Number, default: 0 },
    description: { type: String, default: "" },
  },
  { _id: false },
);

const educationSchema = new mongoose.Schema(
  {
    degree: { type: String, default: "" },
    field: { type: String, default: "" },
    institution: { type: String, default: "" },
    startDate: { type: String, default: "" },
    endDate: { type: String, default: "" },
    grade: { type: String, default: "" },
  },
  { _id: false },
);

const certificationSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    issuer: { type: String, default: "" },
    date: { type: String, default: "" },
  },
  { _id: false },
);

const languageSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    proficiency: { type: String, default: "" },
  },
  { _id: false },
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    description: { type: String, default: "" },
    technologies: { type: [String], default: [] },
    link: { type: String, default: "" },
  },
  { _id: false },
);

const improvementsSchema = new mongoose.Schema(
  {
    improvedSummary: { type: String, default: "" },
    suggestions: { type: [String], default: [] },
    rewrittenBullets: { type: [String], default: [] },
    disclaimer: { type: String, default: "" },
  },
  { _id: false },
);

const analysisSchema = new mongoose.Schema(
  {
    /** The `User.resumes` subdocument this was produced from. */
    resume: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    /** Overall CV score, 0-100. */
    score: { type: Number, required: true, min: 0, max: 100 },
    scoreBreakdown: { type: [scoreBreakdownSchema], default: [] },

    profile: { type: profileSchema, default: () => ({}) },
    skills: { type: [skillSchema], default: [] },
    experience: { type: [experienceSchema], default: [] },
    education: { type: [educationSchema], default: [] },
    certifications: { type: [certificationSchema], default: [] },
    languages: { type: [languageSchema], default: [] },
    projects: { type: [projectSchema], default: [] },

    /** Words the AI pulled out that are worth matching against a posting. */
    keywords: { type: [String], default: [] },

    strengths: { type: [String], default: [] },
    weaknesses: { type: [String], default: [] },
    recommendations: { type: [String], default: [] },

    /** Populated by the "Improve my CV" endpoint. */
    improvements: {
      type: improvementsSchema,
      default: undefined,
    },

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

export const analysisSchemaDefinition = analysisSchema;
export default analysisSchema;
