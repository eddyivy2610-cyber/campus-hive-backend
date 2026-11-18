-- Stores, Listings, and Follow tables + User.storesCount
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "storesCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "Store" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "slugLower" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT,
  "campus" TEXT,
  "operatingLocation" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "followersCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Store_slug_key" ON "Store"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Store_slugLower_key" ON "Store"("slugLower");
CREATE INDEX IF NOT EXISTS "Store_ownerId_idx" ON "Store"("ownerId");
CREATE INDEX IF NOT EXISTS "Store_status_idx" ON "Store"("status");

ALTER TABLE "Store"
  ADD CONSTRAINT "Store_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "Listing" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "price" DOUBLE PRECISION NOT NULL,
  "category" TEXT,
  "campus" TEXT,
  "location" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Listing_status_createdAt_id_idx" ON "Listing"("status", "createdAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Listing_storeId_idx" ON "Listing"("storeId");
CREATE INDEX IF NOT EXISTS "Listing_sellerId_idx" ON "Listing"("sellerId");

ALTER TABLE "Listing"
  ADD CONSTRAINT "Listing_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Listing"
  ADD CONSTRAINT "Listing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "Follow" (
  "id" TEXT NOT NULL,
  "followerId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Follow_followerId_storeId_key" ON "Follow"("followerId", "storeId");
CREATE INDEX IF NOT EXISTS "Follow_storeId_idx" ON "Follow"("storeId");

ALTER TABLE "Follow"
  ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Follow"
  ADD CONSTRAINT "Follow_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
