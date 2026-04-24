import mongoose from "mongoose";
import Order from "../models/Order.js";
import Listing from "../models/Listing.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";

/**
 * Get seller dashboard stats
 */
export const getSellerDashboardStats = async (req, res) => {
    try {
        const sellerId = req.user.id;

        // 1. Calculate Real-time Stats
        const totalEarningsData = await Order.aggregate([
            { $match: { sellerId: new mongoose.Types.ObjectId(sellerId), status: "delivered" } },
            { $group: { _id: null, total: { $sum: "$totalAmount" }, count: { $sum: 1 } } }
        ]);

        const totalEarnings = totalEarningsData[0]?.total || 0;
        const totalOrders = totalEarningsData[0]?.count || 0;
        const activeListings = await Listing.countDocuments({ sellerId, status: "active" });
        const totalImpressions = await Listing.aggregate([
            { $match: { sellerId: new mongoose.Types.ObjectId(sellerId) } },
            { $group: { _id: null, totalViews: { $sum: "$views" } } }
        ]);

        const impressions = totalImpressions[0]?.totalViews || 0;

        // Fetch User for achievements and other static info
        const user = await User.findById(sellerId).select("businessProfile rating achievements");
        if (!user) return res.status(404).json({ message: "User not found" });

        // 2. Fetch Recent Activity
        const recentNotifications = await Notification.find({ recipient: sellerId })
            .sort({ createdAt: -1 })
            .limit(8);

        const recentOrders = await Order.find({ sellerId })
            .sort({ createdAt: -1 })
            .limit(5)
            .populate("buyerId", "profile.displayName");

        // Combine and format activity
        const activity = [
            ...recentNotifications.map(n => ({
                type: n.title,
                detail: n.message,
                time: n.createdAt,
                id: n._id
            })),
            ...recentOrders.map(o => ({
                type: "New Order",
                detail: `Order #${o.orderId} from ${o.buyerId?.profile?.displayName || "Guest"}`,
                time: o.createdAt,
                id: o._id
            }))
        ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8);

        // 3. Chart Data
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const year = new Date().getFullYear();
        
        const orders = await Order.find({ 
            sellerId, 
            status: "delivered",
            createdAt: { $gte: new Date(year, 0, 1) } 
        });

        const monthlyStats = months.map((m, i) => ({
            name: m,
            sold: 0,
            qty: 0
        }));

        orders.forEach(order => {
            const month = new Date(order.createdAt).getMonth();
            monthlyStats[month].sold += order.totalAmount;
            monthlyStats[month].qty += order.items.reduce((sum, item) => sum + item.quantity, 0);
        });

        // 4. Top Performing Items
        const topItems = await Listing.find({ sellerId })
            .sort({ views: -1 })
            .limit(4)
            .select("title views price images");

        // 5. Category Distribution
        const categoryStats = await Listing.aggregate([
            { $match: { sellerId: new mongoose.Types.ObjectId(sellerId) } },
            { $group: { _id: "$category", value: { $sum: 1 } } },
            { $project: { name: "$_id", value: 1, _id: 0 } },
            { $sort: { value: -1 } }
        ]);

        res.status(200).json({
            success: true,
            data: {
                stats: {
                    totalEarnings,
                    totalOrders,
                    activeListings,
                    followers: user.businessProfile?.followersCount || 0,
                    rating: user.rating,
                    impressions
                },
                activity,
                chartData: monthlyStats,
                topItems: topItems.map(item => ({
                    name: item.title,
                    views: item.views || 0,
                    price: item.price,
                    image: item.images?.[0] || ""
                })),
                donutData: categoryStats,
                achievements: user.achievements || []
            }
        });

    } catch (error) {
        console.error("Dashboard stats error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
