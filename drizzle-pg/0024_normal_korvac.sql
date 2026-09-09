CREATE TABLE "project_publish_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"wordpress_base_url" text,
	"wp_username" text,
	"wp_app_password_sealed" text,
	"woo_consumer_key" text,
	"woo_consumer_secret_sealed" text,
	"novamira_mode" text,
	"novamira_base_url" text,
	"novamira_key_sealed" text,
	"pages_channel" text DEFAULT 'manual' NOT NULL,
	"products_channel" text DEFAULT 'wp_rest' NOT NULL,
	"publishing_enabled" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_publish_settings" ADD CONSTRAINT "project_publish_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_publish_settings_project_id_uidx" ON "project_publish_settings" USING btree ("project_id");