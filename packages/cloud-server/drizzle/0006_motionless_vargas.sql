CREATE TYPE "public"."feedback_report_status" AS ENUM('pending', 'complete', 'comment_only');--> statement-breakpoint
CREATE TABLE "feedback_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"computer_id" uuid NOT NULL,
	"machine_identity_id" uuid,
	"access_session_id" uuid,
	"status" "feedback_report_status" DEFAULT 'pending' NOT NULL,
	"comment" text NOT NULL,
	"thread_id" text,
	"cwd" text,
	"archive_storage_key" text,
	"archive_sha256" text,
	"archive_bytes" integer,
	"file_count" integer,
	"error_message" text,
	"client_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"machine_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_computer_id_computers_id_fk" FOREIGN KEY ("computer_id") REFERENCES "public"."computers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_machine_identity_id_machine_identities_id_fk" FOREIGN KEY ("machine_identity_id") REFERENCES "public"."machine_identities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_reports" ADD CONSTRAINT "feedback_reports_access_session_id_computer_access_sessions_id_fk" FOREIGN KEY ("access_session_id") REFERENCES "public"."computer_access_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_reports_user_created_at_idx" ON "feedback_reports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_reports_computer_created_at_idx" ON "feedback_reports" USING btree ("computer_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_reports_status_created_at_idx" ON "feedback_reports" USING btree ("status","created_at");