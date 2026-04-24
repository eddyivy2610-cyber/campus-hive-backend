import Follower from "../models/Follower.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";

/**
 * Toggle following a user
 */
export const toggleFollow = async (req, res) => {
    try {
        const followerId = req.user.id;
        const { followingId } = req.params;

        if (followerId === followingId) {
            return res.status(400).json({ message: "You cannot follow yourself" });
        }

        const existingFollow = await Follower.findOne({ followerId, followingId });

        if (existingFollow) {
            // Unfollow
            await Follower.findByIdAndDelete(existingFollow._id);
            
            // Decrement followersCount in User model
            await User.findByIdAndUpdate(followingId, { $inc: { "businessProfile.followersCount": -1 } });

            return res.status(200).json({ success: true, message: "Unfollowed successfully", isFollowing: false });
        } else {
            // Follow
            await Follower.create({ followerId, followingId });

            // Increment followersCount in User model
            const targetUser = await User.findByIdAndUpdate(followingId, { $inc: { "businessProfile.followersCount": 1 } });

            // Notify target user
            await Notification.create({
                recipient: followingId,
                type: "system",
                title: "New Follower!",
                message: `${req.user.profile.displayName} is now following you!`,
                link: `/profile/${req.user.profile.handle}`
            });

            return res.status(200).json({ success: true, message: "Followed successfully", isFollowing: true });
        }
    } catch (error) {
        console.error("Follow toggle error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

/**
 * Check if following a user
 */
export const checkFollowing = async (req, res) => {
    try {
        const followerId = req.user.id;
        const { followingId } = req.params;

        const follow = await Follower.findOne({ followerId, followingId });

        res.status(200).json({ success: true, isFollowing: !!follow });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
};
