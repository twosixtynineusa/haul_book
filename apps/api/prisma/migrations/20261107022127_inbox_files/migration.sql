-- CreateEnum
CREATE TYPE "InboxStatus" AS ENUM ('waiting', 'processing', 'needs_input', 'failed', 'converted', 'duplicate', 'dismissed');

-- CreateTable
CREATE TABLE "inbox_files" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folder_company" TEXT,
    "size" INTEGER NOT NULL,
    "mtime_ms" DOUBLE PRECISION NOT NULL,
    "sha256" TEXT,
    "status" "InboxStatus" NOT NULL DEFAULT 'waiting',
    "format" TEXT,
    "company" TEXT,
    "unit" TEXT,
    "needs" TEXT[],
    "error" TEXT,
    "outputs" TEXT[],
    "archived_path" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbox_files_status_idx" ON "inbox_files"("status");

-- CreateIndex
CREATE INDEX "inbox_files_path_idx" ON "inbox_files"("path");

-- CreateIndex
CREATE INDEX "inbox_files_sha256_idx" ON "inbox_files"("sha256");
