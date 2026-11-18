import "dotenv/config";
import prisma from "../src/prisma.ts";

async function main() {
  const drifted = await prisma.$queryRaw<
    Array<{ id: string; email: string; storesCount: number; actualCount: bigint }>
  >`
    SELECT u.id, u.email, u."storesCount", COUNT(s.id) AS "actualCount"
    FROM "User" u
    LEFT JOIN "Store" s ON s."ownerId" = u.id
    GROUP BY u.id, u.email, u."storesCount"
    HAVING u."storesCount" <> COUNT(s.id)
  `;

  if (drifted.length > 0) {
    console.error("[DRIFT DETECTED] User.storesCount mismatch:", drifted);
    process.exit(1);
  }
  console.log("[DRIFT CHECK PASSED] Zero drift between User.storesCount and Store row counts.");
}

main()
  .catch((err) => {
    console.error("[DRIFT CHECK ERROR]", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
