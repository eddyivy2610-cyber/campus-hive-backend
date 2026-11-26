-- CreateTable
CREATE TABLE IF NOT EXISTS "RadarPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestText" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'all',
    "budget" TEXT NOT NULL DEFAULT '',
    "campus" TEXT NOT NULL DEFAULT 'Main Campus',
    "location" TEXT NOT NULL DEFAULT 'Main Campus',
    "status" TEXT NOT NULL DEFAULT 'active',
    "replies" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadarPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RadarPost_status_createdAt_idx" ON "RadarPost"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "RadarPost_userId_idx" ON "RadarPost"("userId");
