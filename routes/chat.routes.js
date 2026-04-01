import { Router } from "express";
import { getUserConversations, getMessages, sendMessage } from "../controllers/chat.controller.js";

const router = Router();

router.get("/user/:userId", getUserConversations);
router.get("/:conversationId/messages", getMessages);
router.post("/send", sendMessage);

export default router;
