-- CreateEnum
CREATE TYPE "public"."Channel" AS ENUM ('email', 'sms');

-- CreateEnum
CREATE TYPE "public"."SlotKind" AS ENUM ('T_MINUS_24H', 'T_MINUS_2H');

-- CreateEnum
CREATE TYPE "public"."PlanStatus" AS ENUM ('scheduled', 'sent', 'canceled', 'expired');

-- CreateEnum
CREATE TYPE "public"."AttemptStatus" AS ENUM ('success', 'transient_fail', 'permanent_fail');

-- CreateEnum
CREATE TYPE "public"."ShadowStatus" AS ENUM ('active', 'canceled');

-- CreateTable
CREATE TABLE "public"."AppointmentShadow" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "patientTz" TEXT NOT NULL,
    "channelPreference" "public"."Channel" NOT NULL,
    "startAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "public"."ShadowStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AppointmentShadow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SchedulePlan" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "slotKind" "public"."SlotKind" NOT NULL,
    "plannedLocal" TIMESTAMP(6) NOT NULL,
    "plannedUtc" TIMESTAMPTZ(6) NOT NULL,
    "windowRule" TEXT,
    "status" "public"."PlanStatus" NOT NULL DEFAULT 'scheduled',
    "jobKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SchedulePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QueuedJob" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "runAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "backoffStrategy" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "QueuedJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeliveryLog" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "channel" "public"."Channel" NOT NULL,
    "attempt" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL,
    "finishedAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "public"."AttemptStatus" NOT NULL,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "latencyMs" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "DeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProviderEvent" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "raw" JSONB NOT NULL,

    CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppointmentShadow_clinicId_idx" ON "public"."AppointmentShadow"("clinicId");

-- CreateIndex
CREATE INDEX "AppointmentShadow_patientId_idx" ON "public"."AppointmentShadow"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentShadow_appointmentId_version_key" ON "public"."AppointmentShadow"("appointmentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulePlan_jobKey_key" ON "public"."SchedulePlan"("jobKey");

-- CreateIndex
CREATE INDEX "SchedulePlan_appointmentId_idx" ON "public"."SchedulePlan"("appointmentId");

-- CreateIndex
CREATE INDEX "SchedulePlan_slotKind_idx" ON "public"."SchedulePlan"("slotKind");

-- CreateIndex
CREATE UNIQUE INDEX "QueuedJob_jobKey_key" ON "public"."QueuedJob"("jobKey");

-- CreateIndex
CREATE INDEX "QueuedJob_queue_idx" ON "public"."QueuedJob"("queue");

-- CreateIndex
CREATE INDEX "DeliveryLog_jobKey_idx" ON "public"."DeliveryLog"("jobKey");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryLog_jobKey_attempt_key" ON "public"."DeliveryLog"("jobKey", "attempt");

-- CreateIndex
CREATE INDEX "ProviderEvent_jobKey_idx" ON "public"."ProviderEvent"("jobKey");
