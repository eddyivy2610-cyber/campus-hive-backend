import mongoose, { Schema, model } from "mongoose";

/**
 * User Model for Campus Market.
 * Covers both Buyer and Seller (Vendor) roles with comprehensive profiles.
 */

const UserSchema = new Schema(
  {
    // ============================================================
    // AUTHENTICATION & ACCOUNT
    // ============================================================
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    password: {
      type: String,
      required: function() {
        return this.provider === "email";
      },
      select: false,
      minlength: [8, "Password must be at least 8 characters"],
    },
    provider: {
      type: String,
      enum: ["email", "google", "apple"],
      default: "email",
    },
    providerId: {
      type: String,
      default: null,
    },

    // ============================================================
    // PROFILE INFORMATION
    // ============================================================
    profile: {
      displayName: {
        type: String,
        required: false, // Defaulting to handle/fullName initially
        trim: true,
        minlength: [3, "Display name must be at least 3 characters"],
        maxlength: [50, "Display name cannot exceed 50 characters"],
      },
      handle: {
        type: String,
        unique: true,
        lowercase: true,
        trim: true,
        index: true,
      },
      bio: {
        type: String,
        default: "Hey I'm using Campus Hive!",
        maxlength: [500, "Bio cannot exceed 500 characters"],
      },
      avatar: {
        type: String,
        default: null,
      },
      coverImage: {
        type: String,
        default: null,
      },
    },

    onboardingStep: {
        type: String,
        enum: ["otp_verified", "profile_completed", "onboarding_choice", "seller_pending", "completed"],
        default: "otp_verified",
    },

    sellerStatus: {
        type: String,
        enum: ["none", "pending", "approved", "rejected"],
        default: "none",
    },

    sellerApplication: {
        idImage: String,
        appliedAt: Date,
        rejectedReason: String,
        approvedAt: Date,
    },

    // ============================================================
    // PERSONAL & STUDENT DETAILS
    // ============================================================
    personalDetails: {
      fullName: {
        type: String,
        trim: true,
        maxlength: [100, "Full name cannot exceed 100 characters"],
      },
      dateOfBirth: Date,
      stateOfOrigin: String,
      address: {
        type: String,
        default: "",
      },
      department: {
        type: String,
        default: "",
      },
      phones: {
        type: [String],
        default: [],
      },
    },
    settings: {
        privacy: {
            showEmail: { type: Boolean, default: false },
            showPhone: { type: Boolean, default: false },
            publicProfile: { type: Boolean, default: true },
        },
        notifications: {
            email: { type: Boolean, default: true },
            push: { type: Boolean, default: true },
        }
    },
    studentStatus: {
      isStudent: {
        type: Boolean,
        default: false,
      },
      isVerified: {
        type: Boolean,
        default: false,
      },
      status: {
        type: String,
        enum: ["student", "alumni", "community"],
        default: "community",
      },
      schoolName: {
        type: String,
        default: "",
      },
      idCardImage: {
        type: String,
        default: "",
      },
      studentId: String,
      enrollmentYear: Number,
      graduationYear: Number,
    },

    // ============================================================
    // ROLE & BUSINESS PROFILE (Seller Specific)
    // ============================================================
    role: {
      type: String,
      enum: ["seller", "buyer", "admin"],
      required: [true, "User role is required"],
      index: true,
    },
    businessProfile: {
      name: {
        type: String,
        default: "",
      },
      description: {
        type: String,
        maxlength: [2000], // Extended Bio
      },
      tags: {
        type: [String],
        default: [],
      },
      category: {
        type: String,
        default: "General",
      },
      policies: {
        type: String,
        default: "Standard campus trading policies apply."
      },
      workingHours: {
        type: String,
        default: "Always online",
      },
      responseRate: { type: String, default: "100%" },
      responseTime: { type: String, default: "within hours" },
      followersCount: { type: Number, default: 0 },
      soldItemsCount: { type: Number, default: 0 },
      activeListingsCount: { type: Number, default: 0 },
      totalSalesAmount: { type: Number, default: 0 },
    },

    // ============================================================
    // SOCIAL & ACHIEVEMENTS
    // ============================================================
    socialLinks: {
      whatsapp: String,
      instagram: String,
      twitter: String,
      linkedin: String,
    },
    achievements: [{
      name: String,
      icon: String, // Lucide icon name
      color: String, // Tailwind color class
      type: {
        type: String,
        enum: ["Achievement", "System", "Legacy"],
        default: "Achievement",
      },
      description: String,
      unlockedAt: { type: Date, default: Date.now }
    }],

    // ============================================================
    // ACCOUNT STATUS & METRICS
    // ============================================================
    accountStatus: {
      type: String,
      enum: ["active", "suspended", "deleted", "banned"],
      default: "active",
      index: true,
    },
    rating: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
    agreedToTerms: {
      type: Boolean,
      required: true,
    },
    emailVerified: { type: Boolean, default: false },
    lastLoginAt: Date,
    loginCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.password;
        return ret;
      },
    },
  }
);

// Pre-save hook for handle generation
UserSchema.pre("save", async function() {
  if (this.isModified("profile.displayName") || !this.profile.handle) {
    this.profile.handle = this.profile.displayName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""); // Matches frontend squash logic
  }
});

// Virtual for full profile URL
UserSchema.virtual("profileUrl").get(function() {
  return `/users/${this._id}`;
});

UserSchema.methods.updateLastLogin = async function() {
  this.lastLoginAt = new Date();
  this.loginCount += 1;
  return this.save();
};

const User = mongoose.models.User || model("User", UserSchema);
export default User;
