import { Schema, model, Types, models } from "mongoose";

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
      enum: ["errand_runner", "client"],
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

const IdentityVerification = models.IdentityVerification || model(
  "IdentityVerification",
  IdentityVerificationSchema
);

export default IdentityVerification;