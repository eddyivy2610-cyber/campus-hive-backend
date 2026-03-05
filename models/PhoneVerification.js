import mongoose from "mongoose";

const PhoneVerificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    phone: {
      type: String,
      required: true,
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

const PhoneVerification =
  mongoose.models.PhoneVerification ||
  mongoose.model("PhoneVerification", PhoneVerificationSchema);

export default PhoneVerification;