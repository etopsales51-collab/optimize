import { sql } from "drizzle-orm";
import { index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { user } from "./better-auth-schema";
import { RESEARCH_RUN_PAGES } from "@/shared/researchRuns";

// Postgres mirror of ../research-runs.schema.ts. Structure must stay identical
// or schema-parity.test.ts fails. See that file for what each column is for.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const researchRuns = pgTable(
  "research_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    page: text("page", { enum: RESEARCH_RUN_PAGES }).notNull(),
    toolName: text("tool_name").notNull(),
    source: text("source", { enum: ["mcp", "app"] })
      .notNull()
      .default("mcp"),
    actorLabel: text("actor_label").notNull(),
    target: text("target").notNull(),
    searchJson: text("search_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("research_runs_project_page_created_idx").on(
      table.projectId,
      table.page,
      table.createdAt,
    ),
  ],
);

export const researchHistoryLists = pgTable(
  "research_history_lists",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    listKey: text("list_key").notNull(),
    itemsJson: text("items_json").notNull().default("[]"),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.projectId, table.listKey] }),
  ],
);
