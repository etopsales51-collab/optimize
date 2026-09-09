-- Optimize module tables, plus three location_code default changes.
--
-- The matching SQLite migration (drizzle/0045) deliberately OMITS those default
-- changes. Same drift, different cost: Postgres does ALTER COLUMN SET DEFAULT
-- as a metadata-only change, while SQLite has no ALTER for defaults and drizzle
-- emits a DROP-and-recreate of three populated tables to achieve it. Cheap here,
-- risky there, so it is applied here and skipped there.

CREATE TABLE "optimize_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"recommendation_id" text NOT NULL,
	"author_type" text NOT NULL,
	"author_id" text NOT NULL,
	"author_label" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimize_job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"recommendation_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"detail_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimize_recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"domain" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"priority" text DEFAULT 'p2' NOT NULL,
	"type" text NOT NULL,
	"target_url" text NOT NULL,
	"canonical_path" text,
	"primary_query" text,
	"secondary_queries_json" text DEFAULT '[]' NOT NULL,
	"merge_json" text,
	"evidence_json" text DEFAULT '[]' NOT NULL,
	"proposal_json" text DEFAULT '{}' NOT NULL,
	"cannibalization_check_json" text DEFAULT '{}' NOT NULL,
	"page_snapshot_json" text,
	"preview_html" text,
	"execution_json" text DEFAULT '{}' NOT NULL,
	"created_by_agent" text NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"last_comment_at" text,
	"approved_by_user_id" text,
	"approved_at" text,
	"dismissed_reason" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "location_code" SET DEFAULT 2784;--> statement-breakpoint
ALTER TABLE "rank_tracking_configs" ALTER COLUMN "location_code" SET DEFAULT 2784;--> statement-breakpoint
ALTER TABLE "saved_keywords" ALTER COLUMN "location_code" SET DEFAULT 2784;--> statement-breakpoint
ALTER TABLE "optimize_comments" ADD CONSTRAINT "optimize_comments_recommendation_id_optimize_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."optimize_recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimize_job_events" ADD CONSTRAINT "optimize_job_events_recommendation_id_optimize_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."optimize_recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimize_recommendations" ADD CONSTRAINT "optimize_recommendations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "optimize_comments_recommendation_id_idx" ON "optimize_comments" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "optimize_job_events_recommendation_id_idx" ON "optimize_job_events" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "optimize_recommendations_project_id_idx" ON "optimize_recommendations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "optimize_recommendations_project_status_idx" ON "optimize_recommendations" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "optimize_recommendations_target_url_idx" ON "optimize_recommendations" USING btree ("target_url");