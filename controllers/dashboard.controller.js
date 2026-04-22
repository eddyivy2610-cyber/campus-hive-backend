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

        // 1. Fetch User (Seller) Stats from Profile
        const user = await User.findById(sellerId).select("businessProfile rating achievements");
        if (!user) return res.status(404).json({ message: "User not found" });

        // 2. Fetch Recent Activity (Recent Orders and Notifications)
        const recentNotifications = await Notification.find({ recipient: sellerId })
            .sort({ createdAt: -1 })
            .limit(5);

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
        ].sort((a, b) => b.time - a.time).slice(0, 5);

        // 3. Chart Data (Revenue over time - last 7 months or last 7 days)
        // For now, let's group by month for the last 12 months
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const year = new Date().getFullYear();
        
        const orders = await Order.find({ 
            sellerId, 
            status: "delivered",
            createdAt: { $gte: new Date(year, 0, 1) } 
        });

        const monthlyStats = Array(12).fill(0).map((_, i) => ({
            name: months[i],
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
        const listings = await Listing.find({ sellerId }).select("category");
        const categoryCounts = {};
        listings.forEach(l => {
            categoryCounts[l.category] = (categoryCounts[l.category] || 0) + 1;
        });
        const donutData = Object.entries(categoryCounts)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);

        res.status(200).json({
            success: true,
            data: {
                stats: {
                    totalEarnings: user.businessProfile.totalSalesAmount,
                    totalOrders: user.businessProfile.soldItemsCount,
                    activeListings: user.businessProfile.activeListingsCount,
                    followers: user.businessProfile.followersCount,
                    rating: user.rating,
                    impressions: listings.reduce((sum, l) => sum + (l.views || 0), 0)
                },
                activity,
                chartData: monthlyStats,
                topItems: topItems.map(item => ({
                    name: item.title,
                    views: item.views || 0,
                    price: item.price,
                    image: item.images?.[0] || ""
                })),
                donutData,
                achievements: user.achievements || []
            }
        });

    } catch (error) {
        console.error("Dashboard stats error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
