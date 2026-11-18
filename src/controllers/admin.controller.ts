import { Response } from "express";
import prisma from "../prisma.ts";
import { AuthenticatedRequest } from "../middlewares/auth.middleware.ts";
import { toPublicStore } from "../lib/serializers.ts";

export async function adminUpdateStoreStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const storeId = String(req.params.id || "");
    const { action, reason } = req.body || {};
    if (action !== "suspend" && action !== "restore") {
      res.status(400).json({ message: "Invalid action; expected 'suspend' or 'restore'", error: "bad_request" });
      return;
    }

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      res.status(404).json({ message: "Store not found", error: "not_found" });
      return;
    }

    if (action === "suspend") {
      const effectiveReason = typeof reason === "string" && reason.trim() ? reason.trim() : "Policy violation";
      const updated = await prisma.$transaction(async (tx) => {
        const s = await tx.store.update({
          where: { id: storeId },
          data: { status: "suspended", suspensionReason: effectiveReason },
        });
        await tx.listing.updateMany({
          where: { storeId, status: "active" },
          data: { status: "paused", pausedBy: "store_suspension" },
        });
        return s;
      });
      res.status(200).json({ success: true, data: toPublicStore(updated) });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.store.update({
        where: { id: storeId },
        data: { status: "active", suspensionReason: null },
      });
      await tx.listing.updateMany({
        where: { storeId, status: "paused", pausedBy: "store_suspension" },
        data: { status: "active", pausedBy: null },
      });
      return s;
    });
    res.status(200).json({ success: true, data: toPublicStore(updated) });
  } catch (err) {
    console.error("Admin store update error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}
