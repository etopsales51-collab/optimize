CREATE TABLE "wordpress_page_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"wp_page_id" integer,
	"schema_version" text DEFAULT 'optimize-page-v1' NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"document_json" text NOT NULL,
	"remote_modified_gmt" text,
	"preview_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wordpress_page_drafts" ADD CONSTRAINT "wordpress_page_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wordpress_page_drafts_project_slug_uidx" ON "wordpress_page_drafts" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "wordpress_page_drafts_project_wp_page_uidx" ON "wordpress_page_drafts" USING btree ("project_id","wp_page_id");
