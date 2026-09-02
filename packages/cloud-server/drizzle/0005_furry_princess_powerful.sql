ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
WITH "usernames" AS (
	SELECT
		"id",
		CASE
			WHEN length("base_username") < 3 THEN 'user-' || substring("id"::text from 1 for 8)
			ELSE "base_username"
		END AS "base_username"
	FROM (
		SELECT
			"id",
			substring(regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9_-]+', '-', 'g') from 1 for 32) AS "base_username"
		FROM "users"
	) "normalized"
),
"deduped_usernames" AS (
	SELECT
		"id",
		"base_username",
		row_number() OVER (PARTITION BY "base_username" ORDER BY "id") AS "username_index"
	FROM "usernames"
)
UPDATE "users"
SET "username" = CASE
	WHEN "deduped_usernames"."username_index" = 1 THEN "deduped_usernames"."base_username"
	ELSE substring("deduped_usernames"."base_username" from 1 for 32) || '-' || "deduped_usernames"."username_index"::text
END
FROM "deduped_usernames"
WHERE "users"."id" = "deduped_usernames"."id";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");
