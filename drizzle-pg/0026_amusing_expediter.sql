CREATE TABLE "research_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"page" text NOT NULL,
	"tool_name" text NOT NULL,
	"source" text DEFAULT 'mcp' NOT NULL,
	"actor_label" text NOT NULL,
	"target" text NOT NULL,
	"search_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_runs_project_page_created_idx" ON "research_runs" USING btree ("project_id","page","created_at");