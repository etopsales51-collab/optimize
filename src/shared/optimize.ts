import { z } from "zod";

/**
 * The Optimize contract, shared by the UI, the server and both DB dialects.
 *
 * Agents are external and untrusted, so every payload they send is parsed with
 * the Zod schemas below at the trust boundary rather than cast. The enum tuples
 * live here (not in the schema files) so the client can render a status filter
 * without importing Drizzle, and so the two dialect schemas cannot drift.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const OPTIMIZE_STATUSES = [
  "draft",
  "pending_approval",
  "changes_requested",
  "approved",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "dismissed",
] as const;
export type OptimizeStatus = (typeof OPTIMIZE_STATUSES)[number];

export const OPTIMIZE_TYPES = [
  "on_page",
  "content_refresh",
  "meta",
  "internal_links",
  "technical",
  "merge_pages",
  "new_page_brief",
] as const;
export type OptimizeType = (typeof OPTIMIZE_TYPES)[number];

export const OPTIMIZE_PRIORITIES = ["p0", "p1", "p2", "p3"] as const;
export type OptimizePriority = (typeof OPTIMIZE_PRIORITIES)[number];

export const OPTIMIZE_STATUS_LABELS: Record<OptimizeStatus, string> = {
  draft: "Draft",
  pending_approval: "Needs review",
  changes_requested: "Changes requested",
  approved: "Approved",
  running: "Applying",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  dismissed: "Dismissed",
};

export const OPTIMIZE_TYPE_LABELS: Record<OptimizeType, string> = {
  on_page: "On-page",
  content_refresh: "Content refresh",
  meta: "Meta",
  internal_links: "Internal links",
  technical: "Technical",
  merge_pages: "Merge pages",
  new_page_brief: "New page brief",
};

// ---------------------------------------------------------------------------
// State machine
//
// One table, read by the service and by the UI's button states, so "why is
// Approve disabled" has exactly one answer. Succeeded, cancelled and dismissed
// are final — a finished job is re-run by creating a new recommendation, not by
// reviving this one. `failed` is the exception, and the reason is below.
// ---------------------------------------------------------------------------

export const OPTIMIZE_TRANSITIONS: Record<OptimizeStatus, OptimizeStatus[]> = {
  draft: ["pending_approval", "cancelled"],
  // Staff can approve, ask for changes, or drop it.
  pending_approval: ["approved", "changes_requested", "dismissed"],
  // The agent revises and resubmits; staff can still drop it.
  changes_requested: ["pending_approval", "dismissed"],
  approved: ["running", "cancelled"],
  running: ["succeeded", "failed"],
  succeeded: [],
  // A failed publish is recoverable, not final. The failure is almost always
  // operational — a wrong credential, a site that was briefly unreachable —
  // while the human approval of the CONTENT still stands. Retrying returns it
  // to `approved`, from which publishing runs every gate again. It never
  // re-enters the queue unapproved, so this is not a way around review.
  failed: ["approved", "dismissed"],
  cancelled: [],
  dismissed: [],
};

export function canTransition(
  from: OptimizeStatus,
  to: OptimizeStatus,
): boolean {
  return OPTIMIZE_TRANSITIONS[from].includes(to);
}

/** Approve is a staff action and only ever legal from a submitted proposal. */
export function canApprove(status: OptimizeStatus): boolean {
  return status === "pending_approval";
}

/** A failed publish can be retried once the underlying problem is fixed. */
export function canRetryPublish(status: OptimizeStatus): boolean {
  return status === "failed";
}

/** Nothing may reach WordPress unless it passed through Approve. */
export function isExecutable(status: OptimizeStatus): boolean {
  return status === "approved";
}

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

export const evidenceRefSchema = z.object({
  // Which module the evidence came from; drives the source chip in the UI.
  source: z.enum([
    "site_audit",
    "rank_tracking",
    "gsc_striking_distance",
    "brand_lookup",
    "backlinks",
    "competitor",
    "cannibalization",
  ]),
  label: z.string().min(1).max(300),
  // Pointer back to the row this came from, so the detail view can deep-link.
  refId: z.string().max(200).optional(),
  url: z.string().url().max(2000).optional(),
  metric: z.string().max(120).optional(),
  value: z.union([z.string().max(200), z.number()]).optional(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const cannibalizationCheckSchema = z.object({
  status: z.enum(["clear", "overlap_found", "merge_recommended"]),
  method: z.enum([
    "sitemap_embed",
    "title_h1_overlap",
    "query_overlap",
    "manual",
  ]),
  overlappingUrls: z
    .array(
      z.object({
        url: z.string().url().max(2000),
        title: z.string().max(500).optional(),
        score: z.number().min(0).max(1).optional(),
        reason: z.string().max(500).optional(),
      }),
    )
    .max(50)
    .default([]),
  notes: z.string().max(2000).default(""),
});
export type CannibalizationCheck = z.infer<typeof cannibalizationCheckSchema>;

export const mergePlanSchema = z.object({
  keepUrl: z.string().url().max(2000),
  mergeFromUrls: z.array(z.string().url().max(2000)).min(1).max(20),
  redirectPlan: z
    .array(z.object({ from: z.string().max(2000), to: z.string().max(2000) }))
    .max(20)
    .default([]),
  consolidatedOutline: z.string().max(20000).optional(),
});
export type MergePlan = z.infer<typeof mergePlanSchema>;

/** The machine-executable change set. Every field is a Before/After pair. */
export const optimizeProposalSchema = z.object({
  title: z.object({ before: z.string().max(500), after: z.string().max(500) }).optional(),
  metaDescription: z
    .object({ before: z.string().max(1000), after: z.string().max(1000) })
    .optional(),
  h1: z.object({ before: z.string().max(500), after: z.string().max(500) }).optional(),
  // Section-level content edits, rendered as the body of the preview.
  sections: z
    .array(
      z.object({
        heading: z.string().max(300),
        action: z.enum(["add", "rewrite", "remove", "keep"]),
        before: z.string().max(50000).optional(),
        after: z.string().max(50000).optional(),
      }),
    )
    .max(60)
    .default([]),
  internalLinks: z
    .array(
      z.object({
        anchor: z.string().max(300),
        toUrl: z.string().url().max(2000),
        action: z.enum(["add", "remove"]),
      }),
    )
    .max(60)
    .default([]),
  // The brand this product belongs to, e.g. "ViRDi", "UBio", "Nitgen". Used to
  // file a newly created product under its brand category instead of
  // Uncategorized. Optional: when absent it is inferred from the H1, but an
  // agent that knows the brand should say so rather than leave it to a guess.
  brand: z.string().max(80).optional(),
  // Manufacturer documents for this product — a catalog or datasheet PDF, the
  // thing staff were previously digging out of `notes` by hand. A first-class
  // field so the card carries the URL and publishing can act on it.
  //
  // Documents only. Product photography is commissioned, not scraped off a
  // manufacturer's site, so images are rejected rather than silently ignored.
  attachments: z
    .array(
      z.object({
        kind: z.enum(["catalog", "datasheet", "manual", "certificate"]),
        label: z.string().min(1).max(200),
        url: z
          .string()
          .url()
          .max(2000)
          .refine(
            (value) => !/\.(jpe?g|png|gif|webp|avif|svg|bmp)(\?|#|$)/i.test(value),
            "Attachments are documents, not images — product photography is handled outside this app.",
          ),
      }),
    )
    .max(10)
    .default([]),
  notes: z.string().max(5000).default(""),
});
export type OptimizeProposal = z.infer<typeof optimizeProposalSchema>;

export const pageSnapshotSchema = z.object({
  url: z.string().url().max(2000),
  fetchedAt: z.string(),
  statusCode: z.number().int().optional(),
  title: z.string().max(500).optional(),
  metaDescription: z.string().max(1000).optional(),
  h1: z.string().max(500).optional(),
  wordCount: z.number().int().optional(),
  contentHash: z.string().max(200).optional(),
});
export type PageSnapshot = z.infer<typeof pageSnapshotSchema>;

export const executionStateSchema = z.object({
  channel: z
    .enum(["novamira", "wp_rest", "novamira_mcp", "manual"])
    .default("manual"),
  dryRunOk: z.boolean().optional(),
  externalJobId: z.string().max(200).optional(),
  error: z.string().max(2000).optional(),
});
export type ExecutionState = z.infer<typeof executionStateSchema>;

// ---------------------------------------------------------------------------
// Write payloads (what agents send)
// ---------------------------------------------------------------------------

export const createRecommendationSchema = z.object({
  type: z.enum(OPTIMIZE_TYPES),
  priority: z.enum(OPTIMIZE_PRIORITIES).default("p2"),
  targetUrl: z.string().url().max(2000),
  primaryQuery: z.string().max(300).optional(),
  secondaryQueries: z.array(z.string().max(300)).max(50).default([]),
  evidence: z.array(evidenceRefSchema).max(100).default([]),
  proposal: optimizeProposalSchema,
  // Required on create: Part H is enforced server-side, so an agent cannot
  // propose a new page without having done the overlap work first.
  cannibalizationCheck: cannibalizationCheckSchema,
  merge: mergePlanSchema.optional(),
  pageSnapshot: pageSnapshotSchema.optional(),
  // Submitted straight for review unless the agent is still assembling it.
  status: z.enum(["draft", "pending_approval"]).default("pending_approval"),
});
export type CreateRecommendationInput = z.infer<
  typeof createRecommendationSchema
>;

export const updateRecommendationSchema = createRecommendationSchema
  .partial()
  .extend({
    // A revision after `changes_requested` should say what changed; it becomes
    // the agent's comment in the thread.
    revisionNote: z.string().max(2000).optional(),
  });
export type UpdateRecommendationInput = z.infer<
  typeof updateRecommendationSchema
>;

export const addCommentSchema = z.object({
  body: z.string().min(1).max(10000),
});

export const requestChangesSchema = z.object({
  // Required: "request changes" with no instruction wastes an agent round-trip.
  body: z.string().min(1).max(10000),
});

// ---------------------------------------------------------------------------
// Part H — the rule the server enforces, stated once
// ---------------------------------------------------------------------------

/**
 * A new page is only allowed when the overlap scan came back clear.
 *
 * Two pages competing for one intent is the failure this prevents: "mail
 * management system" and "mail management solution" are the same intent and
 * must not become two URLs. When overlap exists the agent must either improve
 * the existing page or merge, never add a third.
 */
export function newPageBriefAllowed(check: CannibalizationCheck): boolean {
  return check.status === "clear" && check.overlappingUrls.length === 0;
}
