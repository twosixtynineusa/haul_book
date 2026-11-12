-- CreateTable
CREATE TABLE "stored_outputs" (
    "name" TEXT NOT NULL,
    "csv" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "trips" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_outputs_pkey" PRIMARY KEY ("name")
);
