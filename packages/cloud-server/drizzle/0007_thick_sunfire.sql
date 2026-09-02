DELETE FROM "release_manifests" WHERE "target" = 'desktop';--> statement-breakpoint
ALTER TABLE "release_manifests" ALTER COLUMN "target" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."release_target";--> statement-breakpoint
CREATE TYPE "public"."release_target" AS ENUM('machine-server');--> statement-breakpoint
ALTER TABLE "release_manifests" ALTER COLUMN "target" SET DATA TYPE "public"."release_target" USING "target"::"public"."release_target";
