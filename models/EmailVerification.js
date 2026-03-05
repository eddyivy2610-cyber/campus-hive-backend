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

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    verifiedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

const EmailVerification = mongoose.model("EmailVerification", EmailVerificationSchema);

export default EmailVerification;