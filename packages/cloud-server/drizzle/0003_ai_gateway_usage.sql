CREATE TABLE "ai_usage_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usage_request_id" uuid NOT NULL,
	"request_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_body" text,
	"request_body_truncated" boolean DEFAULT false NOT NULL,
	"response_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_body" text,
	"response_body_truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"computer_id" uuid NOT NULL,
	"machine_identity_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"method" text NOT NULL,
	"upstream_path" text NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage_payloads" ADD CONSTRAINT "ai_usage_payloads_usage_request_id_ai_usage_requests_id_fk" FOREIGN KEY ("usage_request_id") REFERENCES "public"."ai_usage_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_requests" ADD CONSTRAINT "ai_usage_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_requests" ADD CONSTRAINT "ai_usage_requests_computer_id_computers_id_fk" FOREIGN KEY ("computer_id") REFERENCES "public"."computers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_requests" ADD CONSTRAINT "ai_usage_requests_machine_identity_id_machine_identities_id_fk" FOREIGN KEY ("machine_identity_id") REFERENCES "public"."machine_identities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_payloads_usage_request_id_unique" ON "ai_usage_payloads" USING btree ("usage_request_id");--> statement-breakpoint
CREATE INDEX "ai_usage_requests_user_started_at_idx" ON "ai_usage_requests" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "ai_usage_requests_computer_started_at_idx" ON "ai_usage_requests" USING btree ("computer_id","started_at");