import { Router } from "express";
import { getUser, updateUser, getAllUsers } from "../controllers/user.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

router.get("/me", protect, (req, res) => {
    // req.user is already populated by the protect middleware
    res.status(200).json({ success: true, data: req.user });
});
router.get("/", protect, getAllUsers);
router.get("/:userId", protect, getUser);
router.patch("/update/:userId", protect, updateUser);

export default router;
