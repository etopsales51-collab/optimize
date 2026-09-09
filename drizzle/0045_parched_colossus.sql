-- Optimize module: three new tables. Nothing else.
--
-- drizzle-kit also wanted to rebuild projects, saved_keywords and
-- rank_tracking_configs (DROP TABLE + recreate) to catch up on an unrelated
-- default change: location_code moved 2840 -> 2784 in the schema back in
-- September and no migration was generated then. Those rebuilds are removed
-- here deliberately.
--
-- The drift is harmless: a column DEFAULT only applies to inserts that omit
-- the column, and every write path sends location_code explicitly. Rebuilding
-- three populated tables on a live volume to change a default nobody reads is
-- risk without benefit. If that default is ever worth fixing it should be its
-- own migration, reviewed on its own.

CREATE TABLE `optimize_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`recommendation_id` text NOT NULL,
	`author_type` text NOT NULL,
	`author_id` text NOT NULL,
	`author_label` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`recommendation_id`) REFERENCES `optimize_recommendations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `optimize_comments_recommendation_id_idx` ON `optimize_comments` (`recommendation_id`);--> statement-breakpoint
CREATE TABLE `optimize_job_events` (
	`id` text PRIMARY KEY NOT NULL,
	`recommendation_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`recommendation_id`) REFERENCES `optimize_recommendations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `optimize_job_events_recommendation_id_idx` ON `optimize_job_events` (`recommendation_id`);--> statement-breakpoint
CREATE TABLE `optimize_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`domain` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`priority` text DEFAULT 'p2' NOT NULL,
	`type` text NOT NULL,
	`target_url` text NOT NULL,
	`canonical_path` text,
	`primary_query` text,
	`secondary_queries_json` text DEFAULT '[]' NOT NULL,
	`merge_json` text,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`proposal_json` text DEFAULT '{}' NOT NULL,
	`cannibalization_check_json` text DEFAULT '{}' NOT NULL,
	`page_snapshot_json` text,
	`preview_html` text,
	`execution_json` text DEFAULT '{}' NOT NULL,
	`created_by_agent` text NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`last_comment_at` text,
	`approved_by_user_id` text,
	`approved_at` text,
	`dismissed_reason` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `optimize_recommendations_project_id_idx` ON `optimize_recommendations` (`project_id`);--> statement-breakpoint
CREATE INDEX `optimize_recommendations_project_status_idx` ON `optimize_recommendations` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `optimize_recommendations_target_url_idx` ON `optimize_recommendations` (`target_url`);
