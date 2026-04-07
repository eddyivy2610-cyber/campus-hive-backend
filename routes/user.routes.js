import { Router } from "express";
import { getUser, updateUser, getAllUsers } from "../controllers/user.controller.js";
import { protect } from "../utils/auth.js";

const router = Router();

router.get("/", protect, getAllUsers); // Should probably be admin only, but for now just protected
router.get("/:userId", protect, getUser);
router.patch("/update/:userId", protect, updateUser);

export default router;
