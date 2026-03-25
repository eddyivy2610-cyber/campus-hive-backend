import mongoose, { Schema, model } from "mongoose";
import argon2 from "argon2";

const UserSchema = new Schema(
  {
    // Core authentication fields
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
      required: false,
      select: false,
      minlength: [8, "Password must be at least 8 characters"],
    },

    // Profile information
    profile: {
      displayName: {
        type: String,
        required: [true, "Display name is required"],
        unique: true,
        trim: true,
        minlength: [3, "Display name must be at least 3 characters"],
        maxlength: [50, "Display name cannot exceed 50 characters"],
      },
      bio: {
        type: String,
        default: "Hey I'm using Campus Market!",
        maxlength: [500, "Bio cannot exceed 500 characters"],
      },
      avatar: {
        type: String,
        default: null,
        validate: {
          validator: function(v) {
            return !v || v.startsWith("http");
          },
          message: "Avatar must be a valid URL",
        },
      },
    },

    // Personal information
    personalDetails: {
      fullName: {
        type: String,
        trim: true,
        maxlength: [100, "Full name cannot exceed 100 characters"],
      },
      dateOfBirth: {
        type: Date,
        validate: {
          validator: function(v) {
            return !v || v <= new Date();
          },
          message: "Date of birth cannot be in the future",
        },
      },
      stateOfOrigin: {
        type: String,
        trim: true,
      },
      phones: {
        type: [String],
        default: [],
        validate: {
          validator: function(phones) {
            return phones.every(p => /^\+?[\d\s-]{10,}$/.test(p));
          },
          message: "Invalid phone number format",
        },
      },
    },

    // Student information
    studentStatus: {
      isStudent: {
        type: Boolean,
        default: false,
      },
      departmentFaculty: {
        type: String,
        default: "",
        trim: true,
      },
      // studentId: {
      //   type: String,
      //   sparse: true,
      //   unique: true,
      // },
      // enrollmentYear: {
      //   type: Number,
      //   min: 1900,
      //   max: new Date().getFullYear() + 5,
      // },
    },

    // Business/seller information
    role: {
      type: String,
      enum: ["seller", "buyer", "admin"],
      required: [true, "User role is required"],
      index: true,
    },
    businessProfile: {
      name: {
        type: String,
        trim: true,
        validate: {
          validator: function(v) {
            return this.role !== "seller" || (v && v.length > 0);
          },
          message: "Business name is required for sellers",
        },
      },
      description: {
        type: String,
        maxlength: [1000, "Business description cannot exceed 1000 characters"],
      },
      tags: {
        type: [String],
        default: [],
        validate: {
          validator: function(tags) {
            return tags.length <= 10;
          },
          message: "Maximum 10 business tags allowed",
        },
      },
    },

    // Verification and identification
    identification: {
      imageUrl: {
        type: String,
        validate: {
          validator: function(v) {
            return !v || v.startsWith("http");
          },
          message: "Identification image must be a valid URL",
        },
      },
      verified: {
        type: Boolean,
        default: false,
      },
      verifiedAt: Date,
      verificationMethod: {
        type: String,
        enum: ["manual", "automated", "third_party"],
      },
    },

    // Account status and tracking
    accountStatus: {
      type: String,
      enum: ["active", "suspended", "deleted", "temporarily_deactivated", "banned"],
      default: "active",
      index: true,
    },
    accountDeactivationReason: {
      type: String,
      enum: ["user_request", "policy_violation", "inactivity", "other"],
    },
    deactivatedAt: Date,

    // Ratings and agreements
    rating: {
      average: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
      },
      count: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    agreedToTerms: {
      type: Boolean,
      required: [true, "User must agree to terms and conditions"],
    },
    agreedToTermsAt: Date,

    // Verification flags
    emailVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: String,
    emailVerificationExpires: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,

    // Session and activity tracking
    lastLoginAt: Date,
    lastActiveAt: Date,
    loginCount: {
      type: Number,
      default: 0,
    },
    previousLoginAt: Date,

    // Security and compliance
    ipAddresses: [String],
    deviceInfo: {
      type: Map,
      of: String,
    },
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      select: false,
    },

    // Metadata
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.password;
        delete ret.emailVerificationToken;
        delete ret.passwordResetToken;
        delete ret.twoFactorSecret;
        return ret;
      },
    },
  }
);

// Indexes for better query performance
UserSchema.index({ "profile.displayName": 1 });
UserSchema.index({ role: 1, accountStatus: 1 });
UserSchema.index({ "rating.average": -1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ lastLoginAt: -1 });

// Virtual for full profile URL
UserSchema.virtual("profileUrl").get(function() {
  return `/users/${this._id}`;
});


// Pre-save middleware
// UserSchema.pre("save", async function(next) {
//   if (this.isModified("agreedToTerms") && this.agreedToTerms) {
//     this.agreedToTermsAt = new Date();
//   }
  
//   if (this.isModified("accountStatus") && this.accountStatus === "deleted") {
//     this.deactivatedAt = new Date();
//   }

//   try {
//     // Hash password using Argon2 with recommended parameters
//     this.password = await argon2.hash(this.password, {
//       type: argon2.argon2id,
//       memoryCost: 2 ** 12,  // 4 MB - Very fast, still secure
//       timeCost: 2,          // 2 iterations
//       parallelism: 1,
//       hashLength: 32,
//       saltLength: 16,
//     });
//     next();
//   } catch (error) {
//     next(error);
//   }
  
// });

// Methods
UserSchema.methods.updateLastLogin = async function() {
  this.previousLoginAt = this.lastLoginAt;
  this.lastLoginAt = new Date();
  this.loginCount += 1;
  this.lastActiveAt = new Date();
  return this.save();
};

UserSchema.methods.updateRating = async function(newRating) {
  const totalRating = this.rating.average * this.rating.count;
  this.rating.count += 1;
  this.rating.average = (totalRating + newRating) / this.rating.count;
  return this.save();
};

const User = mongoose.models.User || model("User", UserSchema);
export default User;