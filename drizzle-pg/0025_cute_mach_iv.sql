CREATE TABLE "whatsapp_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"recipient_id" text,
	"direction" text NOT NULL,
	"kind" text DEFAULT 'message' NOT NULL,
	"alert_type" text,
	"author" text DEFAULT 'system' NOT NULL,
	"from_number" text NOT NULL,
	"to_number" text NOT NULL,
	"body" text NOT NULL,
	"media_url" text,
	"message_sid" text,
	"status" text,
	"error" text,
	"dedupe_key" text,
	"created_by" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_inbound_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_recipient_id_whatsapp_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."whatsapp_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_recipients" ADD CONSTRAINT "whatsapp_recipients_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_messages_org_created_idx" ON "whatsapp_messages" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_recipient_created_idx" ON "whatsapp_messages" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_project_created_idx" ON "whatsapp_messages" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_sid_idx" ON "whatsapp_messages" USING btree ("message_sid");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_dedupe_idx" ON "whatsapp_messages" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_recipients_org_phone_uidx" ON "whatsapp_recipients" USING btree ("organization_id","phone");