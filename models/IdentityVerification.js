import mongoose, { Schema, model, Types } from "mongoose";

const IdentityVerificationSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    role: {
      type: String,
      enum: ["student", "alumni", "community_member", "vendor"],
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    document: {
      type: {
        type: String, // NIN, Passport, Driver’s License
        required: true,
      },

      frontImageUrl: {
        type: String,
        required: true,
      },

      backImageUrl: {
        type: String,
      },

      selfieImageUrl: {
        type: String,
      },
    },

    metadata: {
      ipAddress: String,
      userAgent: String,
      submittedFrom: String, // ios | android | web
    },

    review: {
      reviewedBy: {
        type: Types.ObjectId,
        ref: "Admin",
      },
      reviewedAt: Date,
      rejectionReason: String,
    },

    expiresAt: Date,
  },
  {
    timestamps: true,
  }
);

const IdentityVerification = mongoose.models.IdentityVerification || model(
  "IdentityVerification",
  IdentityVerificationSchema
);

export default IdentityVerification;