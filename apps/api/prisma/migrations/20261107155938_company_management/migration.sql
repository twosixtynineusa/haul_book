-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "dot_number" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "ifta_account" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "sources" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "inbox_files" ADD COLUMN     "confirm_source" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "known_sources" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "units" ADD COLUMN     "last_converted_at" TIMESTAMP(3),
ADD COLUMN     "last_period_end" DATE,
ADD COLUMN     "last_source" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "plate" TEXT,
ADD COLUMN     "vin" TEXT;

-- Backfill: every company and truck saved so far came from a Wialon conversion
-- (the only importer built), so Wialon is their approved / last source.
UPDATE "companies" SET "sources" = ARRAY['wialon']::TEXT[];
UPDATE "units" SET "last_source" = 'wialon';
