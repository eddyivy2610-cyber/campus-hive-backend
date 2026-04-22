import mongoose, { Schema, model } from "mongoose";
import bcrypt from "bcryptjs";

const AdminSchema = new Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      select: false,
      minlength: [8, "Password must be at least 8 characters"],
    },
    role: {
      type: String,
      enum: ["superadmin", "moderator"],
      default: "moderator",
    },
    lastLoginAt: Date,
    loginCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
    }
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
AdminSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare password
AdminSchema.methods.comparePassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const Admin = mongoose.models.Admin || model("Admin", AdminSchema);
export default Admin;
