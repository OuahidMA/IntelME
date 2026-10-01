import mongoose from "mongoose";

/**
 * The account document, and the only document in the database.
 *
 * Three fields: a name, an email and a bcrypt hash of the password. That is the
 * whole of what this app keeps server-side. A CV, its analysis and every job
 * match belong to the candidate and are never sent to us to be filed away — the
 * uploaded file is parsed, the text is handed back to the browser, the file is
 * deleted from disk, and from that point on the version, its score and the
 * matches scored against it live in the user's own `localStorage` under
 * `intelme.data.<userId>` (see `client/src/Services/localStore.js`).
 *
 * So registering an account writes exactly one document with exactly those three
 * values, and deleting it is one `deleteOne` with no cascade to run: nothing
 * about a CV exists here to leave behind.
 *
 * The cost of that trade is honest and worth stating — there is no cross-device
 * sync. Sign in on another browser and the account is there, empty.
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
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  {
    // `strict` is the default and is stated here because it is now load-bearing
    // in a way it was not before: this document must be exactly the three fields
    // a form can supply. A stray `resumes` key on a create call is dropped rather
    // than written, so no code path can quietly put CV data back in the database.
    strict: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
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