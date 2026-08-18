ALTER TABLE "submission" ALTER COLUMN "raw_body" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "purged_at" timestamp;--> statement-breakpoint
CREATE INDEX "submission_purged_at_created_at_idx" ON "submission" USING btree ("purged_at","created_at");