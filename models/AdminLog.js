import mongoose, { Schema, model } from "mongoose";

const AdminLogSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        "account_creation",
        "verification_pending",
        "verification_approved",
        "verification_rejected",
        "admin_action",
        "system",
        "report",
        "listing",
        "listing_approved",
        "listing_rejected",
      ],
    },
    message: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    metadata: {
      type: Object,
      default: {},
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

AdminLogSchema.pre(["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate"], function () {
  this.setOptions({ runValidators: true });
});

const AdminLog = mongoose.models.AdminLog || model("AdminLog", AdminLogSchema);
export default AdminLog;
