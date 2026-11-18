-- Create AccountStatus enum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'BANNED');

-- Backfill & migrate User.accountStatus from TEXT DEFAULT 'active' to AccountStatus DEFAULT 'PENDING'
ALTER TABLE "User" ALTER COLUMN "accountStatus" DROP DEFAULT;
ALTER TABLE "User"
  ALTER COLUMN "accountStatus" TYPE "AccountStatus"
  USING (
    CASE
      WHEN LOWER("accountStatus") = 'suspended' THEN 'SUSPENDED'::"AccountStatus"
      WHEN LOWER("accountStatus") = 'banned' THEN 'BANNED'::"AccountStatus"
      WHEN "isEmailVerified" = true AND LOWER("accountStatus") = 'active' THEN 'ACTIVE'::"AccountStatus"
      ELSE 'PENDING'::"AccountStatus"
    END
  );
ALTER TABLE "User" ALTER COLUMN "accountStatus" SET DEFAULT 'PENDING';

-- Migrate Role enum to (BUYER, SELLER, ADMIN) with default BUYER and backfill USER -> BUYER
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;
UPDATE "User" SET "role" = 'BUYER' WHERE "role" = 'USER';
DROP TYPE "Role";
CREATE TYPE "Role" AS ENUM ('BUYER', 'SELLER', 'ADMIN');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'BUYER';
