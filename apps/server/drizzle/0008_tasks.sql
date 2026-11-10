CREATE TABLE IF NOT EXISTS "page_tasks" (
	"page_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"space_id" uuid NOT NULL,
	"assignee_id" uuid,
	"due" date,
	"checked" boolean NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "page_tasks_page_id_task_id_pk" PRIMARY KEY("page_id","task_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "page_tasks" ADD CONSTRAINT "page_tasks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "page_tasks" ADD CONSTRAINT "page_tasks_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "page_tasks" ADD CONSTRAINT "page_tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "page_tasks_open_idx" ON "page_tasks" USING btree ("assignee_id","due") WHERE "page_tasks"."checked" = false;