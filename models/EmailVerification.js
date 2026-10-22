import mongoose from "mongoose";

const EmailVerificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },

    verificationCode: {
      type: String,
      required: true,
    },

    attempts: {
      type: Number,
      default: 0,
    },

    lastSentAt: {
      type: Date,
      default: Date.now,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    verifiedAt: {
      type: Date,
    },

    schemaVersion: {
      type: Number,
      default: 1,
      required: true,
      index: true,
    },
  },
  { timestamps: true, strict: true }
);

EmailVerificationSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate"], function () {
  this.setOptions({ runValidators: true });
});

const EmailVerification = mongoose.models.EmailVerification || mongoose.model("EmailVerification", EmailVerificationSchema);

export default EmailVerification;
