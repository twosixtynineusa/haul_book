-- One approved source per company (it replaces the list). Each company keeps the source it
-- was approved for most recently: the last one added to the list.
ALTER TABLE "companies" ADD COLUMN     "source" TEXT;
UPDATE "companies" SET "source" = "sources"[array_length("sources", 1)]
WHERE array_length("sources", 1) > 0;
ALTER TABLE "companies" DROP COLUMN "sources";

-- Inbox: the approved source for the switch warning, the companies a unit # is saved under,
-- and the period entered for a file with no dates (Motive's distance summary).
ALTER TABLE "inbox_files" ADD COLUMN     "company_options" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "known_source" TEXT,
ADD COLUMN     "period_begin" DATE,
ADD COLUMN     "period_end" DATE;
UPDATE "inbox_files" SET "known_source" = "known_sources"[array_length("known_sources", 1)]
WHERE array_length("known_sources", 1) > 0;
ALTER TABLE "inbox_files" DROP COLUMN "known_sources";

-- CreateTable
CREATE TABLE "conversions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "unit_id" TEXT,
    "company_name" TEXT NOT NULL,
    "unit_number" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "source" TEXT,
    "source_file" TEXT NOT NULL,
    "output_file" TEXT NOT NULL,
    "begin_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "begin_odo" DECIMAL(12,1),
    "end_odo" DECIMAL(12,1),
    "distance" DECIMAL(12,2) NOT NULL,
    "distance_unit" TEXT NOT NULL,
    "states" TEXT[],
    "trips" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversions_created_at_idx" ON "conversions"("created_at");

-- CreateIndex
CREATE INDEX "conversions_company_id_idx" ON "conversions"("company_id");

-- CreateIndex
CREATE INDEX "conversions_unit_id_idx" ON "conversions"("unit_id");

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
