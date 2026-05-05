CREATE TYPE "public"."release_target" AS ENUM('desktop', 'machine-server');--> statement-breakpoint
CREATE TABLE "release_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" "release_target" NOT NULL,
	"channel" text NOT NULL,
	"platform" text DEFAULT 'default' NOT NULL,
	"version" text NOT NULL,
	"download_url" text,
	"signature_url" text,
	"docker_image" text,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "release_manifests_target_channel_platform_unique" ON "release_manifests" USING btree ("target","channel","platform");