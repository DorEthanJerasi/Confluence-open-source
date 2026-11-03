CREATE TABLE IF NOT EXISTS "page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"doc" jsonb NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_from" integer
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "page_versions_page_version_idx" ON "page_versions" USING btree ("page_id","version" DESC NULLS LAST);--> statement-breakpoint
-- Backfill: every page that existed before history gets one snapshot of its
-- current state, so older pages have history too. Written by hand (not
-- generated). Safe to re-run: pages that already have a snapshot are skipped.
INSERT INTO "page_versions" ("page_id", "version", "title", "doc", "author_id", "created_at", "saved_at")
SELECT p."id", p."version", p."title", p."doc", p."updated_by", p."updated_at", p."updated_at"
FROM "pages" p
WHERE NOT EXISTS (SELECT 1 FROM "page_versions" v WHERE v."page_id" = p."id");
