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
        ref: "User",
      },
      reviewedAt: Date,
      rejectionReason: String,
    },

    expiresAt: Date,
    schemaVersion: {
      type: Number,
      default: 1,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

IdentityVerificationSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate"], function () {
  this.setOptions({ runValidators: true });
});

const IdentityVerification = mongoose.models.IdentityVerification || model(
  "IdentityVerification",
  IdentityVerificationSchema
);

export default IdentityVerification;
