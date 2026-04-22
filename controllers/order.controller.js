import Order from "../models/Order.js";

// Get all orders for admin
export const getAllOrdersAdmin = async (req, res) => {
    try {
        const orders = await Order.find()
            .populate("buyerId", "email profile.displayName")
            .populate("sellerId", "profile.displayName")
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        console.error("Get all orders admin error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Create a new order
export const createOrder = async (req, res) => {
    try {
        const { buyerId, sellerId, items, totalAmount, paymentMethod, fulfillmentMethod } = req.body;
        
        const orderId = "ORD-" + Math.floor(100000 + Math.random() * 900000) + "-CH";

        const newOrder = new Order({
            orderId,
            buyerId,
            sellerId,
            items,
            totalAmount,
            paymentMethod,
            fulfillmentMethod
        });

        await newOrder.save();

        res.status(201).json({ success: true, data: newOrder });
    } catch (error) {
        console.error("Create order error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Get orders for the current seller
export const getSellerOrders = async (req, res) => {
    try {
        const sellerId = req.user.id;
        const orders = await Order.find({ sellerId })
            .populate("buyerId", "profile.displayName profile.avatar email")
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: orders.length,
            data: orders
        });
    } catch (error) {
        console.error("Get seller orders error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};
