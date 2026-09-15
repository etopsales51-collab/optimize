CREATE TABLE `research_history_lists` (
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`list_key` text NOT NULL,
	`items_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`, `list_key`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
