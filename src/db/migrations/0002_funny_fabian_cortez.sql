CREATE TABLE "destination_health" (
	"destination_id" uuid PRIMARY KEY NOT NULL,
	"consecutive_dead_letters" integer DEFAULT 0 NOT NULL,
	"unhealthy_since" timestamp,
	"last_notified_at" timestamp,
	"last_dead_letter_at" timestamp,
	"last_success_at" timestamp,
	"last_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "destination_health" ADD CONSTRAINT "destination_health_destination_id_destination_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destination"("id") ON DELETE cascade ON UPDATE no action;