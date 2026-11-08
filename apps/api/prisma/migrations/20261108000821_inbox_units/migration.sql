-- AlterTable
ALTER TABLE "inbox_files" ADD COLUMN     "units" TEXT[] DEFAULT ARRAY[]::TEXT[];
