CREATE TABLE "agent_session_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"computer_id" uuid NOT NULL,
	"machine_identity_id" uuid NOT NULL,
	"harness" text NOT NULL,
	"native_thread_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"source_path" text,
	"relative_path" text NOT NULL,
	"latest_version_id" uuid,
	"latest_sha256" text,
	"latest_object_key" text,
	"latest_size_bytes" integer,
	"latest_mtime" timestamp with time zone,
	"source_created_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"first_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_session_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_session_thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"computer_id" uuid NOT NULL,
	"machine_identity_id" uuid NOT NULL,
	"harness" text NOT NULL,
	"native_thread_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"sha256" text NOT NULL,
	"object_bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"source_mtime" timestamp with time zone NOT NULL,
	"source_path" text,
	"relative_path" text NOT NULL,
	"source_created_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_session_threads" ADD CONSTRAINT "agent_session_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_threads" ADD CONSTRAINT "agent_session_threads_computer_id_computers_id_fk" FOREIGN KEY ("computer_id") REFERENCES "public"."computers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_threads" ADD CONSTRAINT "agent_session_threads_machine_identity_id_machine_identities_id_fk" FOREIGN KEY ("machine_identity_id") REFERENCES "public"."machine_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_versions" ADD CONSTRAINT "agent_session_versions_agent_session_thread_id_agent_session_threads_id_fk" FOREIGN KEY ("agent_session_thread_id") REFERENCES "public"."agent_session_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_versions" ADD CONSTRAINT "agent_session_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_versions" ADD CONSTRAINT "agent_session_versions_computer_id_computers_id_fk" FOREIGN KEY ("computer_id") REFERENCES "public"."computers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_versions" ADD CONSTRAINT "agent_session_versions_machine_identity_id_machine_identities_id_fk" FOREIGN KEY ("machine_identity_id") REFERENCES "public"."machine_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_threads_computer_harness_native_unique" ON "agent_session_threads" USING btree ("computer_id","harness","native_thread_id");--> statement-breakpoint
CREATE INDEX "agent_session_threads_user_updated_at_idx" ON "agent_session_threads" USING btree ("user_id","source_updated_at");--> statement-breakpoint
CREATE INDEX "agent_session_threads_computer_updated_at_idx" ON "agent_session_threads" USING btree ("computer_id","source_updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_versions_computer_harness_native_sha_unique" ON "agent_session_versions" USING btree ("computer_id","harness","native_thread_id","sha256");--> statement-breakpoint
CREATE INDEX "agent_session_versions_thread_uploaded_at_idx" ON "agent_session_versions" USING btree ("agent_session_thread_id","uploaded_at");