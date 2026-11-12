-- AlterTable
ALTER TABLE "conversions" ADD COLUMN     "promiles_unit" TEXT;

-- AlterTable
ALTER TABLE "inbox_files" ADD COLUMN     "new_trucks" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "promiles_units" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "units" ADD COLUMN     "promiles_unit" TEXT;
