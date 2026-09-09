import { sql } from "drizzle-orm";
import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import {
  OPTIMIZE_PRIORITIES,
  OPTIMIZE_STATUSES,
  OPTIMIZE_TYPES,
} from "@/shared/optimize";

// Postgres mirror of ../optimize.schema.ts. Structure must stay identical —
// same columns, nullability, enums, defaults, primary and foreign keys — or
// schema-parity.test.ts fails. The enum tuples are imported from the SQLite
// file rather than retyped so the two can never drift apart silently.
//
// Timestamps are text (same column shape as SQLite); see the note in
// pg/app.schema.ts.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const timestampColumn = (name: string) => text(name);

export const optimizeRecommendations = pgTable(
  "optimize_recommendations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: text("domain"),

    status: text("status", { enum: OPTIMIZE_STATUSES })
      .notNull()
      .default("draft"),
    priority: text("priority", { enum: OPTIMIZE_PRIORITIES })
      .notNull()
      .default("p2"),
    type: text("type", { enum: OPTIMIZE_TYPES }).notNull(),

    targetUrl: text("target_url").notNull(),
    canonicalPath: text("canonical_path"),

    primaryQuery: text("primary_query"),
    secondaryQueriesJson: text("secondary_queries_json").notNull().default("[]"),

    mergeJson: text("merge_json"),
    evidenceJson: text("evidence_json").notNull().default("[]"),
    proposalJson: text("proposal_json").notNull().default("{}"),
    cannibalizationCheckJson: text("cannibalization_check_json")
      .notNull()
      .default("{}"),
    pageSnapshotJson: text("page_snapshot_json"),

    previewHtml: text("preview_html"),

    executionJson: text("execution_json").notNull().default("{}"),

    createdByAgent: text("created_by_agent").notNull(),

    commentCount: integer("comment_count").notNull().default(0),
    lastCommentAt: timestampColumn("last_comment_at"),

    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestampColumn("approved_at"),
    dismissedReason: text("dismissed_reason"),

    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    index("optimize_recommendations_project_id_idx").on(table.projectId),
    index("optimize_recommendations_project_status_idx").on(
      table.projectId,
      table.status,
    ),
    index("optimize_recommendations_target_url_idx").on(table.targetUrl),
  ],
);

export const optimizeComments = pgTable(
  "optimize_comments",
  {
    id: text("id").primaryKey(),
    recommendationId: text("recommendation_id")
      .notNull()
      .references(() => optimizeRecommendations.id, { onDelete: "cascade" }),
    authorType: text("author_type", { enum: ["user", "agent"] }).notNull(),
    authorId: text("author_id").notNull(),
    authorLabel: text("author_label").notNull(),
    body: text("body").notNull(),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("optimize_comments_recommendation_id_idx").on(table.recommendationId),
  ],
);

export const optimizeJobEvents = pgTable(
  "optimize_job_events",
  {
    id: text("id").primaryKey(),
    recommendationId: text("recommendation_id")
      .notNull()
      .references(() => optimizeRecommendations.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    actor: text("actor").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("optimize_job_events_recommendation_id_idx").on(
      table.recommendationId,
    ),
  ],
);
