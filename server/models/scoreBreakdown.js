import mongoose from "mongoose";

/**
 * One row per scoring category. `weight` is the percentage the category is worth,
 * `score` is the 0-100 the candidate earned inside it and `earned` is
 * `score * weight / 100`. Keeping all three makes the final number auditable:
 * the client can always show how the total was reached.
 */
const scoreBreakdownSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    weight: { type: Number, required: true, min: 0, max: 100 },
    score: { type: Number, required: true, min: 0, max: 100 },
    earned: { type: Number, required: true, min: 0 },
    note: { type: String, default: "" },
  },
  { _id: false },
);

export const scoreBreakdownSchemaDefinition = scoreBreakdownSchema;
export default scoreBreakdownSchema;
