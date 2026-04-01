import { Router } from "express";
import { getUser, updateUser, getAllUsers } from "../controllers/user.controller.js";

const router = Router();

router.get("/", getAllUsers);
router.get("/:userId", getUser);
router.patch("/update/:userId", updateUser);

export default router;
