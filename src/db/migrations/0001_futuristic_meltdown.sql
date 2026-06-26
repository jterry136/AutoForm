CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."form_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "delivery_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"next_run_at" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"locked_by" text,
	"response_status" integer,
	"response_body" text,
	"error" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"encrypted_credentials" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "form_status" DEFAULT 'active' NOT NULL,
	"allowed_origins" text[],
	"redirect_url" text,
	"honeypot_field" text DEFAULT '_gotcha' NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
	"retention_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "form_publicId_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "form_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"definition" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "form_definition_formId_unique" UNIQUE("form_id")
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"raw_body" text NOT NULL,
	"content_type" text,
	"normalized_payload" jsonb NOT NULL,
	"referer" text,
	"client_fingerprint" text,
	"user_agent" text,
	"spam_verdict" text DEFAULT 'clean' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destination" ADD CONSTRAINT "destination_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_definition" ADD CONSTRAINT "form_definition_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_attempt_claim_idx" ON "delivery_attempt" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "delivery_attempt_submission_idx" ON "delivery_attempt" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "delivery_attempt_destination_idx" ON "delivery_attempt" USING btree ("destination_id");--> statement-breakpoint
CREATE INDEX "destination_form_id_idx" ON "destination" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "form_owner_id_idx" ON "form" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "submission_form_id_created_at_idx" ON "submission" USING btree ("form_id","created_at");