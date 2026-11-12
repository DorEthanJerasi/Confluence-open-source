ALTER TABLE "pages" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "locked_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pages" ADD CONSTRAINT "pages_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_lock_check" CHECK ("pages"."locked_by" is null or "pages"."locked_at" is not null);