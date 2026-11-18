import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

async function main() {
  const adminUrl = "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
  const dataDbName = "campus_market_mig_data_test";
  const emptyDbName = "campus_market_mig_empty_test";
  const migrationsDir = path.resolve("prisma/migrations");
  const migrationFolders = fs.readdirSync(migrationsDir).sort();

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  try {
    // 1. Seeded-data migration test: run pre-enum migrations, seed legacy rows, then run enum migration
    await admin.query(`DROP DATABASE IF EXISTS ${dataDbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dataDbName}`);

    const dataClient = new Client({
      connectionString: `postgresql://postgres:postgres@127.0.0.1:5433/${dataDbName}?sslmode=disable`,
    });
    await dataClient.connect();

    try {
      const targetMig = "20261116105500_account_status_and_role_enums";
      for (const folder of migrationFolders) {
        if (folder === targetMig) break;
        const migPath = path.join(migrationsDir, folder, "migration.sql");
        if (fs.existsSync(migPath)) {
          await dataClient.query(fs.readFileSync(migPath, "utf8"));
        }
      }

      // Seed legacy rows covering every case
      const legacyRows = [
        { id: "mig_1", email: "mig1@example.test", user: "mig1", verified: true, status: "active", role: "USER", expStatus: "ACTIVE", expRole: "BUYER" },
        { id: "mig_2", email: "mig2@example.test", user: "mig2", verified: false, status: "active", role: "USER", expStatus: "PENDING", expRole: "BUYER" },
        { id: "mig_3", email: "mig3@example.test", user: "mig3", verified: true, status: "suspended", role: "USER", expStatus: "SUSPENDED", expRole: "BUYER" },
        { id: "mig_4", email: "mig4@example.test", user: "mig4", verified: true, status: "banned", role: "USER", expStatus: "BANNED", expRole: "BUYER" },
        { id: "mig_5", email: "mig5@example.test", user: "mig5", verified: true, status: "Active", role: "ADMIN", expStatus: "ACTIVE", expRole: "ADMIN" },
        { id: "mig_6", email: "mig6@example.test", user: "mig6", verified: false, status: "Active", role: "USER", expStatus: "PENDING", expRole: "BUYER" },
        { id: "mig_7", email: "mig7@example.test", user: "mig7", verified: true, status: "SUSPENDED", role: "USER", expStatus: "SUSPENDED", expRole: "BUYER" },
      ];

      for (const r of legacyRows) {
        await dataClient.query(
          `INSERT INTO "User" ("id", "email", "username", "fullName", "passwordHash", "isEmailVerified", "accountStatus", "role", "updatedAt")
           VALUES ($1, $2, $3, 'Legacy User', 'hash', $4, $5, $6::"Role", NOW())`,
          [r.id, r.email, r.user, r.verified, r.status, r.role]
        );
      }

      // Run 20261116105500_account_status_and_role_enums migration
      const enumMigSql = fs.readFileSync(path.join(migrationsDir, targetMig, "migration.sql"), "utf8");
      await dataClient.query(enumMigSql);

      const res = await dataClient.query(
        `SELECT "id", "accountStatus"::text AS "accountStatus", "role"::text AS "role" FROM "User" ORDER BY "id"`
      );
      const byId = new Map(res.rows.map((row) => [row.id, row]));
      for (const r of legacyRows) {
        const actual = byId.get(r.id);
        assert.ok(actual, `Missing migrated row ${r.id}`);
        assert.equal(actual.accountStatus, r.expStatus, `${r.id} accountStatus mismatch`);
        assert.equal(actual.role, r.expRole, `${r.id} role mismatch`);
        console.log(`[PASS] ${r.id} (verified=${r.verified}, legacyStatus='${r.status}', legacyRole='${r.role}') -> accountStatus=${actual.accountStatus}, role=${actual.role}`);
      }
    } finally {
      await dataClient.end();
    }

    // 2. Empty database full migration chain test
    await admin.query(`DROP DATABASE IF EXISTS ${emptyDbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${emptyDbName}`);
    const emptyClient = new Client({
      connectionString: `postgresql://postgres:postgres@127.0.0.1:5433/${emptyDbName}?sslmode=disable`,
    });
    await emptyClient.connect();
    try {
      for (const folder of migrationFolders) {
        const migPath = path.join(migrationsDir, folder, "migration.sql");
        if (fs.existsSync(migPath)) {
          await emptyClient.query(fs.readFileSync(migPath, "utf8"));
        }
      }
      const defRes = await emptyClient.query(
        `INSERT INTO "User" ("id", "email", "username", "fullName", "passwordHash", "updatedAt")
         VALUES ('empty_1', 'empty1@example.test', 'empty1', 'Empty DB User', 'hash', NOW())
         RETURNING "accountStatus"::text AS "accountStatus", "role"::text AS "role"`
      );
      assert.equal(defRes.rows[0].accountStatus, "PENDING");
      assert.equal(defRes.rows[0].role, "BUYER");
      console.log(`[PASS] Full migration chain on empty DB succeeded (${migrationFolders.length} migrations); defaults: accountStatus=${defRes.rows[0].accountStatus}, role=${defRes.rows[0].role}`);
    } finally {
      await emptyClient.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${dataDbName} WITH (FORCE)`).catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${emptyDbName} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
}

main().catch((err) => {
  console.error("[FAIL]", err);
  process.exit(1);
});
