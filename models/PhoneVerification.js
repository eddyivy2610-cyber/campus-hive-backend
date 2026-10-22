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

    schemaVersion: {
      type: Number,
      default: 1,
      required: true,
      index: true,
    },
  },
  { timestamps: true, strict: true }
);

PhoneVerificationSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate"], function () {
  this.setOptions({ runValidators: true });
});

const PhoneVerification =
  mongoose.models.PhoneVerification ||
  mongoose.model("PhoneVerification", PhoneVerificationSchema);

export default PhoneVerification;
