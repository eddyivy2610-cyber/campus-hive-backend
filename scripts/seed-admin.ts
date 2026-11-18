import "dotenv/config";
import prisma from "../src/prisma.ts";
import { hashPassword } from "../src/lib/password.ts";

/**
 * CLI-only admin onboarding script (never exposed as an HTTP route).
 * Usage:
 *   ADMIN_EMAIL=admin@campushive.edu.ng ADMIN_PASSWORD=... ADMIN_NAME="Lead Admin" npx tsx scripts/seed-admin.ts
 */
async function main() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const fullName = (process.env.ADMIN_NAME || "Platform Administrator").trim();

  if (!email || !password || password.length < 12) {
    console.error("Usage error: ADMIN_EMAIL and ADMIN_PASSWORD (>= 12 chars) are required.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const username = `admin_${email.split("@")[0].replace(/[^a-z0-9_]/gi, "").toLowerCase()}`;

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      role: "ADMIN",
      accountStatus: "ACTIVE",
      isEmailVerified: true,
      passwordHash,
      fullName,
    },
    create: {
      email,
      passwordHash,
      fullName,
      username,
      role: "ADMIN",
      accountStatus: "ACTIVE",
      isEmailVerified: true,
    },
    select: {
      id: true,
      email: true,
      role: true,
      accountStatus: true,
      isEmailVerified: true,
    },
  });

  console.log("[SEED ADMIN OK]", JSON.stringify(admin));
}

main()
  .catch((err) => {
    console.error("[SEED ADMIN ERROR]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
