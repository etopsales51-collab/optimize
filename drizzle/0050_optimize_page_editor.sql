CREATE TABLE `wordpress_page_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`wp_page_id` integer,
	`schema_version` text DEFAULT 'optimize-page-v1' NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`document_json` text NOT NULL,
	`remote_modified_gmt` text,
	`preview_url` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wordpress_page_drafts_project_slug_uidx` ON `wordpress_page_drafts` (`project_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `wordpress_page_drafts_project_wp_page_uidx` ON `wordpress_page_drafts` (`project_id`,`wp_page_id`);
