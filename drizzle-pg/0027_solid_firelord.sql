CREATE TABLE "research_history_lists" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"list_key" text NOT NULL,
	"items_json" text DEFAULT '[]' NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "research_history_lists_user_id_project_id_list_key_pk" PRIMARY KEY("user_id","project_id","list_key")
);
--> statement-breakpoint
ALTER TABLE "research_history_lists" ADD CONSTRAINT "research_history_lists_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_history_lists" ADD CONSTRAINT "research_history_lists_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;