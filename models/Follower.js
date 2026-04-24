import mongoose, { Schema, model, Types } from "mongoose";

const FollowerSchema = new Schema(
    {
        followerId: {
            type: Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        followingId: {
            type: Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        }
    },
    {
        timestamps: true
    }
);

// Prevent duplicate follows
FollowerSchema.index({ followerId: 1, followingId: 1 }, { unique: true });

const Follower = mongoose.models.Follower || model("Follower", FollowerSchema);
export default Follower;
