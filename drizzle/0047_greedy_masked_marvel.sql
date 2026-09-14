CREATE TABLE `whatsapp_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_id` text,
	`recipient_id` text,
	`direction` text NOT NULL,
	`kind` text DEFAULT 'message' NOT NULL,
	`alert_type` text,
	`author` text DEFAULT 'system' NOT NULL,
	`from_number` text NOT NULL,
	`to_number` text NOT NULL,
	`body` text NOT NULL,
	`media_url` text,
	`message_sid` text,
	`status` text,
	`error` text,
	`dedupe_key` text,
	`created_by` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipient_id`) REFERENCES `whatsapp_recipients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `whatsapp_messages_org_created_idx` ON `whatsapp_messages` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `whatsapp_messages_recipient_created_idx` ON `whatsapp_messages` (`recipient_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `whatsapp_messages_project_created_idx` ON `whatsapp_messages` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `whatsapp_messages_sid_idx` ON `whatsapp_messages` (`message_sid`);--> statement-breakpoint
CREATE INDEX `whatsapp_messages_dedupe_idx` ON `whatsapp_messages` (`organization_id`,`dedupe_key`);--> statement-breakpoint
CREATE TABLE `whatsapp_recipients` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_inbound_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_recipients_org_phone_uidx` ON `whatsapp_recipients` (`organization_id`,`phone`);