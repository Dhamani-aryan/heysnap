ALTER TABLE "computers" ADD COLUMN "machine_health" jsonb DEFAULT '{}'::jsonb NOT NULL;
