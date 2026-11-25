-- Sync all tables and columns present in schema.prisma but missing from earlier migrations

-- Store missing columns
ALTER TABLE "Store"
  ADD COLUMN IF NOT EXISTS "logo" TEXT,
  ADD COLUMN IF NOT EXISTS "coverImage" TEXT,
  ADD COLUMN IF NOT EXISTS "storeType" TEXT NOT NULL DEFAULT 'student_store',
  ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "verificationType" TEXT,
  ADD COLUMN IF NOT EXISTS "vacationMode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT;

-- Listing missing columns & index
ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "condition" TEXT,
  ADD COLUMN IF NOT EXISTS "listingType" TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS "serviceDetails" JSONB,
  ADD COLUMN IF NOT EXISTS "slug" TEXT,
  ADD COLUMN IF NOT EXISTS "views" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "Listing_slug_key" ON "Listing"("slug");

-- Order missing columns
ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "storeId" TEXT;

-- Conversation missing columns
ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "storeId" TEXT,
  ADD COLUMN IF NOT EXISTS "context" JSONB;

-- UserPreference table
CREATE TABLE IF NOT EXISTS "UserPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "theme" TEXT NOT NULL DEFAULT 'system',
  "homeFeedPreference" TEXT NOT NULL DEFAULT 'popular',
  "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
  "pushNotifications" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserPreference_userId_key" ON "UserPreference"("userId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserPreference_userId_fkey') THEN
    ALTER TABLE "UserPreference"
      ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Notification table
CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'general',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "link" TEXT,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt" DESC);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_userId_fkey') THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Banner table
CREATE TABLE IF NOT EXISTS "Banner" (
  "id" TEXT NOT NULL,
  "placement" TEXT NOT NULL DEFAULT 'homepage_hero',
  "headline" TEXT NOT NULL,
  "description" TEXT,
  "ctaLabel" TEXT,
  "ctaUrl" TEXT,
  "imageUrl" TEXT NOT NULL,
  "mobileImageUrl" TEXT,
  "imageAlt" TEXT,
  "targetCategory" TEXT,
  "status" TEXT NOT NULL DEFAULT 'published',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Banner_placement_status_priority_idx" ON "Banner"("placement", "status", "priority" DESC);

-- AdminLog table
CREATE TABLE IF NOT EXISTS "AdminLog" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "adminEmail" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AdminLog_createdAt_idx" ON "AdminLog"("createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AdminLog_targetType_targetId_idx" ON "AdminLog"("targetType", "targetId");

-- Report table
CREATE TABLE IF NOT EXISTS "Report" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolutionNote" TEXT,
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Report_status_createdAt_idx" ON "Report"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Report_targetType_targetId_idx" ON "Report"("targetType", "targetId");

-- SellerApplication table
CREATE TABLE IF NOT EXISTS "SellerApplication" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "storeId" TEXT,
  "businessName" TEXT NOT NULL,
  "category" TEXT,
  "campus" TEXT,
  "operatingLocation" TEXT,
  "studentIdUrl" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewNote" TEXT,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SellerApplication_status_createdAt_idx" ON "SellerApplication"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SellerApplication_userId_idx" ON "SellerApplication"("userId");
