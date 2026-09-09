import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";
// Vocabulary is shared with the client and the Postgres mirror so the three
// can never disagree about what a valid status or type is.
import {
  OPTIMIZE_PRIORITIES,
  OPTIMIZE_STATUSES,
  OPTIMIZE_TYPES,
} from "@/shared/optimize";

// ============================================================================
// Optimize tables
//
// A recommendation is a proposal an agent posts for a human to approve. The
// staff UI is the only place it can be approved, and nothing reaches WordPress
// without passing through `approved`.
//
// Several columns hold JSON. That is deliberate and narrow: proposal, evidence,
// snapshot and cannibalization payloads are agent-authored *documents* whose
// shape belongs to the agent contract, not entities this app joins or filters
// on. Anything the app queries — status, type, priority, target URL, comment
// counts — is a real column. Comments and job events, which the app does query
// and paginate, are their own tables rather than arrays in here.
// ============================================================================

export const optimizeRecommendations = sqliteTable(
  "optimize_recommendations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Denormalized from the project at creation time so a recommendation still
    // reads correctly if the project's domain is later changed.
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
    // string[]
    secondaryQueriesJson: text("secondary_queries_json").notNull().default("[]"),

    // { keepUrl, mergeFromUrls[], redirectPlan[], consolidatedOutline } — only
    // populated for type = merge_pages.
    mergeJson: text("merge_json"),
    // EvidenceRef[]: typed pointers into audit/GSC/rank/backlink rows, so the
    // detail view can show *why now* as linked objects rather than prose.
    evidenceJson: text("evidence_json").notNull().default("[]"),
    // The machine-executable change set the execution layer will apply.
    proposalJson: text("proposal_json").notNull().default("{}"),
    // CannibalizationCheck. Server validation reads this before allowing a
    // new_page_brief; see the Optimize service.
    cannibalizationCheckJson: text("cannibalization_check_json")
      .notNull()
      .default("{}"),
    // The live page as it looked when the recommendation was written, so the
    // diff shown at approval time is honest about drift.
    pageSnapshotJson: text("page_snapshot_json"),

    // Server-SANITIZED preview markup. The agent is an external, untrusted
    // author and this renders inside an authenticated staff session, so raw
    // agent HTML must never reach this column.
    previewHtml: text("preview_html"),

    // { channel, dryRunOk, externalJobId, error }
    executionJson: text("execution_json").notNull().default("{}"),

    // Agent identity, logged on every write.
    createdByAgent: text("created_by_agent").notNull(),

    commentCount: integer("comment_count").notNull().default(0),
    lastCommentAt: text("last_comment_at"),

    approvedByUserId: text("approved_by_user_id"),
    approvedAt: text("approved_at"),
    dismissedReason: text("dismissed_reason"),

    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("optimize_recommendations_project_id_idx").on(table.projectId),
    // The list view's default query is "this project, these statuses".
    index("optimize_recommendations_project_status_idx").on(
      table.projectId,
      table.status,
    ),
    // Overlap and merge checks look up other recommendations on a URL.
    index("optimize_recommendations_target_url_idx").on(table.targetUrl),
  ],
);

// The single conversation surface. Staff and agents post into the same thread;
// `authorType` is what the UI uses to render identity.
export const optimizeComments = sqliteTable(
  "optimize_comments",
  {
    id: text("id").primaryKey(),
    recommendationId: text("recommendation_id")
      .notNull()
      .references(() => optimizeRecommendations.id, { onDelete: "cascade" }),
    authorType: text("author_type", { enum: ["user", "agent"] }).notNull(),
    authorId: text("author_id").notNull(),
    // Display name captured at write time so a deleted user or renamed agent
    // does not blank out the history.
    authorLabel: text("author_label").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("optimize_comments_recommendation_id_idx").on(table.recommendationId),
  ],
);

// Append-only audit trail: agent revisions, status transitions, approvals,
// webhook receipts, execution results. Separate from comments because this is
// the record of what happened, not what people said about it.
export const optimizeJobEvents = sqliteTable(
  "optimize_job_events",
  {
    id: text("id").primaryKey(),
    recommendationId: text("recommendation_id")
      .notNull()
      .references(() => optimizeRecommendations.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    // "user:<id>", "agent:<id>", or "system".
    actor: text("actor").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("optimize_job_events_recommendation_id_idx").on(
      table.recommendationId,
    ),
  ],
);
