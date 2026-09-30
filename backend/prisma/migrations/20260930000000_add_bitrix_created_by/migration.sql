-- AlterTable
ALTER TABLE "BitrixConfiguration" ADD COLUMN IF NOT EXISTS "createdById" UUID;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BitrixConfiguration_createdById_fkey'
  ) THEN
    ALTER TABLE "BitrixConfiguration" ADD CONSTRAINT "BitrixConfiguration_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill existing bitrix configuration to the admin user
UPDATE "BitrixConfiguration"
SET "createdById" = (SELECT id FROM "User" WHERE email = 'admin@system.com' LIMIT 1)
WHERE "createdById" IS NULL;
