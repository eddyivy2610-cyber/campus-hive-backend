import "dotenv/config";
import assert from "node:assert/strict";
import { Client } from "pg";

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5433/campus_market_test?sslmode=disable";

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const id1 = `schema_test_${suffix}_1`;
  const email1 = `schema_test_${suffix}_1@example.test`;

  try {
    // 1. Raw SQL INSERT without explicit accountStatus or role must default to PENDING and BUYER (never ACTIVE)
    const insertRes = await client.query(
      `INSERT INTO "User" ("id", "email", "username", "fullName", "passwordHash", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING "accountStatus"::text AS "accountStatus", "role"::text AS "role", "isEmailVerified"`,
      [id1, email1, `user_${suffix}`, "Schema Default User", "dummy_hash"]
    );

    const row = insertRes.rows[0];
    assert.equal(row.accountStatus, "PENDING", `Expected default accountStatus PENDING, got ${row.accountStatus}`);
    assert.notEqual(row.accountStatus.toUpperCase(), "ACTIVE", "User created without explicit status must NEVER be ACTIVE");
    assert.equal(row.role, "BUYER", `Expected default role BUYER, got ${row.role}`);
    assert.equal(row.isEmailVerified, false, "Expected isEmailVerified false by default");
    console.log("[PASS] Direct INSERT without accountStatus/role defaulted to accountStatus=PENDING, role=BUYER");

    // 2. Invalid accountStatus enum value must be rejected by PostgreSQL
    await assert.rejects(
      client.query(
        `INSERT INTO "User" ("id", "email", "username", "fullName", "passwordHash", "accountStatus", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'invalid_status', NOW())`,
        [`${id1}_bad_status`, `bad_status_${email1}`, `bad_s_${suffix}`, "Bad Status", "dummy_hash"]
      ),
      /invalid input value for enum "AccountStatus"/i,
      "Invalid accountStatus enum value must be rejected by PostgreSQL"
    );
    console.log("[PASS] Invalid accountStatus enum value rejected by PostgreSQL");

    // 3. Invalid role enum value must be rejected by PostgreSQL
    await assert.rejects(
      client.query(
        `INSERT INTO "User" ("id", "email", "username", "fullName", "passwordHash", "role", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'SUPERUSER', NOW())`,
        [`${id1}_bad_role`, `bad_role_${email1}`, `bad_r_${suffix}`, "Bad Role", "dummy_hash"]
      ),
      /invalid input value for enum "Role"/i,
      "Invalid role enum value must be rejected by PostgreSQL"
    );
    console.log("[PASS] Invalid role enum value rejected by PostgreSQL");
  } finally {
    await client.query(`DELETE FROM "User" WHERE "id" LIKE $1`, [`schema_test_${suffix}%`]);
    await client.end();
  }
}

main().catch((err) => {
  console.error("[FAIL]", err);
  process.exit(1);
});
