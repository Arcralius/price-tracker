-- Notification delivery slots.
-- Per-account defaults, plus an optional per-item override (empty = inherit).

-- AlterTable
ALTER TABLE "TrackedItem" ADD COLUMN     "notifyTimes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyTimes" TEXT[] DEFAULT ARRAY['09:00']::TEXT[],
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Singapore';
