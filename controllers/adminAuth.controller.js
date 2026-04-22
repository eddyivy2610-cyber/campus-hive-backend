import Admin from "../models/Admin.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your_fallback_secret_key_change_in_production";
const ADMIN_REGISTRATION_KEY = process.env.ADMIN_REGISTRATION_KEY || "hive-admin-2025";

/**
 * Sign Up as Admin
 */
export const adminSignUp = async (req, res) => {
  try {
    const { username, email, password, adminKey } = req.body;

    // Verify admin registration key
    if (adminKey !== ADMIN_REGISTRATION_KEY) {
      return res.status(403).json({ message: "Invalid admin registration key." });
    }

    // Check if admin already exists
    const adminExists = await Admin.findOne({ $or: [{ email }, { username }] });
    if (adminExists) {
      return res.status(400).json({ message: "Admin with this email or username already exists." });
    }

    // Create admin
    const admin = await Admin.create({
      username,
      email,
      password,
    });

    if (admin) {
      res.status(201).json({
        message: "Admin registered successfully.",
        admin: {
          id: admin._id,
          username: admin.username,
          email: admin.email,
        },
      });
    } else {
      res.status(400).json({ message: "Invalid admin data." });
    }
  } catch (error) {
    console.error("Admin Signup Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Sign In as Admin
 */
export const adminSignIn = async (req, res) => {
  try {
    const { identity, password } = req.body;

    // Find admin by username or email
    const admin = await Admin.findOne({
      $or: [
        { email: identity.toLowerCase() },
        { username: identity.toLowerCase() }
      ]
    }).select("+password");

    if (admin && (await admin.comparePassword(password))) {
      // Update login metrics
      admin.lastLoginAt = new Date();
      admin.loginCount += 1;
      await admin.save();

      // Generate token
      const token = jwt.sign(
        { id: admin._id, email: admin.email, role: admin.role, isAdmin: true },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      res.status(200).json({
        message: "Logged in successfully.",
        token,
        user: {
          id: admin._id,
          username: admin.username,
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
