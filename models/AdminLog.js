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
  },
  { timestamps: true }
);

const AdminLog = mongoose.models.AdminLog || model("AdminLog", AdminLogSchema);
export default AdminLog;
