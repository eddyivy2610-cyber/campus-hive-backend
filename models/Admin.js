import mongoose, { Schema, model } from "mongoose";
import argon2 from "argon2";

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

// Method to compare password using argon2
AdminSchema.methods.comparePassword = async function(enteredPassword) {
  return await argon2.verify(this.password, enteredPassword);
};

const Admin = mongoose.models.Admin || model("Admin", AdminSchema);
export default Admin;
