CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`page` text NOT NULL,
	`tool_name` text NOT NULL,
	`source` text DEFAULT 'mcp' NOT NULL,
	`actor_label` text NOT NULL,
	`target` text NOT NULL,
	`search_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `research_runs_project_page_created_idx` ON `research_runs` (`project_id`,`page`,`created_at`);