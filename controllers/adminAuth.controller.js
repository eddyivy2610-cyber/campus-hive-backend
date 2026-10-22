import User from "../models/User.js";
import argon2 from "argon2";
import { generateAdminToken } from "../utils/auth.js";
import { env } from "../utils/env.js";

export const getAdminRegistrationKey = () => {
  return env.ADMIN_REGISTRATION_KEY;
};

/**
 * Sign Up as Admin (Owned exclusively by Next.js)
 */
export const adminSignUp = async (_req, res) => {
  return res.status(405).json({
    success: false,
    error: "METHOD_NOT_ALLOWED",
    message: "Admin registration is owned exclusively by Next.js API (/api/admin/auth/signup).",
  });
};

/**
 * Sign In as Admin (Read-only on User collection)
 */
export const adminSignIn = async (req, res) => {
  try {
    const { identity, password } = req.body;

    const cleanIdentity = String(identity || "").toLowerCase().trim();

    // Find admin by username, handle or email in User collection
    const admin = await User.findOne({
      $or: [
        { email: cleanIdentity },
        { "profile.handle": cleanIdentity },
        { "profile.displayName": cleanIdentity },
      ],
      role: "admin",
    }).select("+password");

    if (admin && (await admin.comparePassword(password))) {
      // In-memory last login tracking (Express is strictly read-only on users)
      admin.lastLoginAt = new Date();
      admin.loginCount = (admin.loginCount || 0) + 1;

      // Generate token with the shared standard claims (iss, aud, sub, HS256)
      const token = generateAdminToken(admin);

      res.status(200).json({
        message: "Logged in successfully.",
        token,
        user: {
          id: admin._id,
          username: admin.profile?.handle || admin.profile?.displayName || admin.personalDetails?.fullName || "admin",
          email: admin.email,
          role: admin.role,
        },
      });
    } else {
      res.status(401).json({ message: "Invalid username/email or password." });
    }
  } catch (error) {
    console.error("Admin Signin Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
