-- AlterTable
ALTER TABLE "units" ADD COLUMN     "odometer" DECIMAL(12,1),
ADD COLUMN     "odometer_as_of" DATE;
