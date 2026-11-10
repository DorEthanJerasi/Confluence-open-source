ALTER TABLE "pages" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "trash_root_id" uuid;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pages" ADD CONSTRAINT "pages_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "spaces" ADD CONSTRAINT "spaces_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pages_trash_idx" ON "pages" USING btree ("space_id","trash_root_id") WHERE "pages"."deleted_at" is not null;--> statement-breakpoint
-- Back-fill (docs/done-checks/11-trash.md, Table changes): every page that was
-- soft-deleted before trash existed joins one trash item, rooted at its topmost
-- deleted ancestor with the same deleted_at (one old delete = one statement =
-- one now()), or at itself.
WITH RECURSIVE "up" AS (
  SELECT "id" AS "page_id", "id" AS "anc_id", "parent_id", "deleted_at", 0 AS "depth"
  FROM "pages" WHERE "deleted_at" IS NOT NULL AND "trash_root_id" IS NULL
  UNION ALL
  SELECT "up"."page_id", "p"."id", "p"."parent_id", "up"."deleted_at", "up"."depth" + 1
  FROM "up" JOIN "pages" "p" ON "p"."id" = "up"."parent_id"
  WHERE "p"."deleted_at" = "up"."deleted_at" AND "up"."depth" < 1000
)
UPDATE "pages" SET "trash_root_id" = "r"."anc_id"
FROM (SELECT DISTINCT ON ("page_id") "page_id", "anc_id" FROM "up" ORDER BY "page_id", "depth" DESC) "r"
WHERE "pages"."id" = "r"."page_id";
