-- AlterTable
ALTER TABLE "public"."SchedulePlan" ADD COLUMN     "plannedLocalISO" TEXT,
ALTER COLUMN "plannedLocal" SET DATA TYPE TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "SchedulePlan_status_plannedUtc_idx" ON "public"."SchedulePlan"("status", "plannedUtc");
