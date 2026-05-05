ALTER TABLE "machine_identities" ALTER COLUMN "token_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "computers" ADD COLUMN "machine_server_version" text;--> statement-breakpoint
ALTER TABLE "machine_identities" ADD COLUMN "bootstrap_token_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "machine_identities_bootstrap_token_hash_unique" ON "machine_identities" USING btree ("bootstrap_token_hash");