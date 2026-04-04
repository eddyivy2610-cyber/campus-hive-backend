import AdminLog from "../models/AdminLog.js";

export const getAdminLogs = async (req, res) => {
  try {
    const { limit = 50, type, from, to, userId } = req.query;
    const query = {};
    if (type) query.type = type;
    if (userId) query.userId = userId;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }
    const logs = await AdminLog.find(query)
      .populate("userId", "profile.displayName email")
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    res.status(200).json({ success: true, count: logs.length, data: logs });
  } catch (error) {
    console.error("Get admin logs error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
