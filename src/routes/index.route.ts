import { Router } from "express";
import authRoute from "./auth.route.ts";

const router = Router();

router.use("/auth", authRoute);

export default router;