ALTER TABLE "computer_access_sessions" ADD COLUMN "scopes" jsonb DEFAULT '["*"]'::jsonb NOT NULL;
