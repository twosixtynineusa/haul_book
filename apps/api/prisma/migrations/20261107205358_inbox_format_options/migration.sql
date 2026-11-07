-- AlterTable
ALTER TABLE "inbox_files" ADD COLUMN     "format_options" TEXT[] DEFAULT ARRAY[]::TEXT[];
