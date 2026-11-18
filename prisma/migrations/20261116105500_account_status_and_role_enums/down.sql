-- LOSSY ROLLBACK for 20261116105500_account_status_and_role_enums
-- WARNING: This rollback is LOSSY:
--   1. Role values 'BUYER' and 'SELLER' are both collapsed back into 'USER' (seller role distinction is lost).
--   2. AccountStatus values are lowercased to TEXT with DEFAULT 'active' (reintroducing the insecure active-by-default schema).
-- Restores User.accountStatus to TEXT DEFAULT 'active' and Role enum to (USER, ADMIN) DEFAULT 'USER'.

ALTER TABLE "User" ALTER COLUMN "accountStatus" DROP DEFAULT;
ALTER TABLE "User"
  ALTER COLUMN "accountStatus" TYPE TEXT
  USING LOWER("accountStatus"::TEXT);
ALTER TABLE "User" ALTER COLUMN "accountStatus" SET DEFAULT 'active';
DROP TYPE IF EXISTS "AccountStatus";

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;
UPDATE "User" SET "role" = 'USER' WHERE "role" IN ('BUYER', 'SELLER');
DROP TYPE IF EXISTS "Role";
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';
