import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";
import { user } from "./better-auth-schema";
import { RESEARCH_RUN_PAGES } from "@/shared/researchRuns";

// ============================================================================
// Research runs — research an agent did over MCP, shown on the Research pages
//
// "Recent searches" are each person's own list; an agent's MCP calls are shared
// with the whole project, so they are logged here and listed as Agent runs: one
// row per researched target, with the page's URL search params to reopen it.
// See shared/researchRuns.ts.
// ============================================================================

export const researchRuns = sqliteTable(
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
    // Who ran it: the MCP client's user, e.g. "etopsales51@gmail.com".
    actorLabel: text("actor_label").notNull(),
    target: text("target").notNull(),
    // URL search params for the page. A navigation payload, not relational data.
    searchJson: text("search_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("research_runs_project_page_created_idx").on(
      table.projectId,
      table.page,
      table.createdAt,
    ),
  ],
);

// ============================================================================
// Research history lists — each page's "Recent searches", kept in the database
//
// These lists used to live only in the browser's localStorage, so a new PC or
// a cleared browser lost them. One row per person, project and page list; the
// items are the page's own history entries, stored as the JSON array the page
// already reads and validates. The shape differs per page and is a display
// list, not relational data, so it stays a document.
// ============================================================================

export const researchHistoryLists = sqliteTable(
  "research_history_lists",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // e.g. "search-history", "brand-lookup-search-history". See RESEARCH_HISTORY_LIST_KEYS.
    listKey: text("list_key").notNull(),
    itemsJson: text("items_json").notNull().default("[]"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.projectId, table.listKey] }),
  ],
);
