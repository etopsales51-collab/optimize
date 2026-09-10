import { z } from "zod";
import { OptimizeService } from "@/server/features/optimize/services/OptimizeService";
import { OptimizeRepository } from "@/server/features/optimize/repositories/OptimizeRepository";
import { analyzeIntentOverlap } from "@/server/features/optimize/intentOverlap";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import {
  cannibalizationCheckSchema,
  evidenceRefSchema,
  mergePlanSchema,
  optimizeProposalSchema,
  pageSnapshotSchema,
  OPTIMIZE_PRIORITIES,
  OPTIMIZE_STATUSES,
  OPTIMIZE_TYPES,
} from "@/shared/optimize";

/**
 * The agent's side of the Optimize loop.
 *
 * Agents PROPOSE here; they never approve, and nothing they post can reach a
 * live site until a person clicks Approve in the Deep Insights UI. Every tool
 * runs through withMcpProjectAuth, so an API key can only post into projects
 * its owner is a member of. Identity is logged on every write: the key's
 * account email, plus the agent label the caller supplies.
 *
 * Part H (anti-cannibalization) is enforced by OptimizeService on create,
 * revise and approve — these tools cannot bypass it, and the rejection text
 * tells the agent what to do instead. analyze_intent_overlap exists so an
 * agent can run that check itself, before it drafts, and paste the result in.
 */

// Who is posting. The key already proves the account; the label is how the
// proposal is attributed in the UI ("SEO Genius"), so staff see a product,
// not a bot dump.
const agentIdentitySchema = {
  agentId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      "Stable identifier for this agent, e.g. 'seo-genius'. Defaults to the API key's account email.",
    ),
  agentLabel: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe(
      "Display name shown to staff on this agent's proposals and comments, e.g. 'SEO Genius'. Defaults to the agentId.",
    ),
} as const;

function agentActor(
  args: { agentId?: string; agentLabel?: string },
  auth: { userEmail: string },
) {
  const id = args.agentId ?? auth.userEmail;
  return { type: "agent" as const, id, label: args.agentLabel ?? id };
}

// Deep link straight to the item. This is the URL agents hand back to staff,
// so it must open the recommendation itself — an ?id= query lands on the list,
// which ignores it and looks like the link is broken.
const optimizePath = (projectId: string, id?: string) =>
  id ? `/p/${projectId}/optimize/${id}` : `/p/${projectId}/optimize`;

const recommendationSummarySchema = z.object({
  id: z.string(),
  status: z.enum(OPTIMIZE_STATUSES),
  type: z.enum(OPTIMIZE_TYPES),
  priority: z.enum(OPTIMIZE_PRIORITIES),
  targetUrl: z.string(),
  primaryQuery: z.string().nullable(),
  commentCount: z.number(),
  lastCommentAt: z.string().nullable(),
  createdByAgent: z.string(),
  updatedAt: z.string(),
});

// ---------------------------------------------------------------------------
// create_optimize_recommendation
// ---------------------------------------------------------------------------

const createInputSchema = {
  projectId: projectIdSchema,
  ...agentIdentitySchema,
  type: z.enum(OPTIMIZE_TYPES).describe(
    "on_page | content_refresh | meta | internal_links | technical | merge_pages | new_page_brief. Prefer improving an existing URL. new_page_brief is REJECTED unless cannibalizationCheck.status is 'clear' with no overlappingUrls — run analyze_intent_overlap first. Publishing decides create-or-update from the live store, so a brief whose product already exists updates it rather than duplicating it.",
  ),
  priority: z.enum(OPTIMIZE_PRIORITIES).optional().describe("p0 (urgent) to p3. Default p2."),
  targetUrl: z.string().url().describe("The existing page this proposal changes. For merge_pages, the page to KEEP."),
  primaryQuery: z.string().max(300).optional(),
  secondaryQueries: z.array(z.string().max(300)).max(50).optional(),
  evidence: z
    .array(evidenceRefSchema)
    .max(100)
    .optional()
    .describe("Why now. Typed pointers into audit / GSC / rank / backlink / competitor data. Staff see these as source chips and links."),
  proposal: optimizeProposalSchema.describe(
    "The machine-executable change set: before/after for title, metaDescription, h1; sections to add/rewrite/remove; internal links. 'after' copy may use simple HTML (p, h2, h3, ul, li, table, strong, a). COPY RULES — title, metaDescription, h1 and sections[].after are CUSTOMER-READY and go live verbatim: no verification asides, no 'verify before publish', no 'portfolio row', no 'no images in this brief', no names, no TODOs. Spec table cells are bare values ('X', 'IP65', '20,000'), never a value plus an essay. Write lean product facts, not manufacturer marketing sentences. Everything you are unsure about goes in `notes`, which staff read and which is never published; process language found in publishable fields is stripped server-side and reported back to you. Set 'brand' to the manufacturer (ViRDi, UBio, Nitgen…) so the product is filed under its brand category — it is otherwise guessed from the h1. Put the manufacturer catalog or datasheet PDF in 'attachments' ({kind: 'catalog'|'datasheet', label, url}) rather than in notes or a section, so staff get a card with Open and Copy; images are rejected there.",
  ),
  cannibalizationCheck: cannibalizationCheckSchema.describe(
    "REQUIRED. Result of your overlap scan. Paste analyze_intent_overlap's cannibalizationCheck verbatim, or supply your own with the URLs you compared.",
  ),
  merge: mergePlanSchema.optional().describe("Required when type is merge_pages: keepUrl, mergeFromUrls, redirectPlan."),
  pageSnapshot: pageSnapshotSchema.optional().describe("The live page as you saw it (title, meta, h1, wordCount). Lets staff see drift at approval time."),
  previewHtml: z
    .string()
    .max(200_000)
    .optional()
    .describe("Optional rendered preview of the proposed page section(s). Sanitized server-side: scripts, styles and event handlers are stripped."),
  status: z
    .enum(["draft", "pending_approval"])
    .optional()
    .describe("pending_approval (default) puts it in front of staff now; draft keeps it hidden while you finish."),
} as const;

type CreateArgs = z.infer<z.ZodObject<typeof createInputSchema>>;

const copyRemovedOutputSchema = z
  .array(z.object({ field: z.string(), text: z.string() }))
  .optional()
  .describe("Process language that was stripped from publishable fields before storage. Move any verification detail here into `proposal.notes`.");

/** Tell the agent what was taken out, so it stops putting it there. */
function describeRemovals(removals: Array<{ field: string; text: string }>): string {
  if (removals.length === 0) return "";
  const shown = removals
    .slice(0, 5)
    .map((removal) => `  - ${removal.field}: "${removal.text}"`)
    .join("\n");
  const more = removals.length > 5 ? `\n  …and ${removals.length - 5} more.` : "";
  return `Stripped ${removals.length} agent note(s) from customer-facing copy — put verification and caveats in proposal.notes instead:\n${shown}${more}`;
}

export const createOptimizeRecommendationTool = {
  name: "create_optimize_recommendation",
  config: {
    title: "Create optimize recommendation",
    description:
      "Post a proposed page optimization into the project's Optimize queue for staff to review, discuss and approve. Uses no credits. Nothing is published by this call: a human must Approve in Deep Insights before anything reaches the live site. Anti-cannibalization is enforced server-side: a new_page_brief is rejected unless cannibalizationCheck is clear with no overlapping URLs; when existing pages cover the intent, propose content_refresh/on_page on the strongest one, or merge_pages if several compete. Returns the recommendation id and a link staff can open.",
    inputSchema: createInputSchema,
    outputSchema: {
      id: z.string(),
      status: z.enum(OPTIMIZE_STATUSES),
      reviewUrl: z.string().optional(),
      copyRemoved: copyRemovedOutputSchema,
      ...optionalMetaOutputSchema,
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: CreateArgs, context) => {
    const { projectId, agentId, agentLabel, previewHtml, ...payload } = args;
    const actor = agentActor({ agentId, agentLabel }, context.auth);

    const { id, removals } = await OptimizeService.createRecommendation({
      projectId,
      domain: context.project.domain ?? null,
      actor,
      payload,
      previewHtml: previewHtml ?? null,
    });

    const created = await OptimizeService.get(id, projectId);
    const meta = buildProjectMeta(context, projectId, optimizePath(projectId, id));

    return mcpResponse({
      text: [
        `Recommendation ${id} created (${created.status}).`,
        `Type: ${created.type} · Priority: ${created.priority} · Target: ${created.targetUrl}`,
        created.status === "pending_approval"
          ? "It is now in the staff review queue. You will see any comments or change requests via list_optimize_comments / get_optimize_recommendation."
          : "Saved as a draft; staff will not see it until you update it with status pending_approval.",
        describeRemovals(removals),
        meta.url ? `Review link: ${meta.url}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      meta,
      structuredContent: {
        id,
        status: created.status,
        reviewUrl: meta.url,
        copyRemoved: removals,
      },
    });
  }),
};

// ---------------------------------------------------------------------------
// update_optimize_recommendation
// ---------------------------------------------------------------------------

const updateInputSchema = {
  projectId: projectIdSchema,
  id: z.string().min(1).describe("The recommendation to revise."),
  ...agentIdentitySchema,
  type: z.enum(OPTIMIZE_TYPES).optional(),
  priority: z.enum(OPTIMIZE_PRIORITIES).optional(),
  targetUrl: z.string().url().optional(),
  primaryQuery: z.string().max(300).optional(),
  secondaryQueries: z.array(z.string().max(300)).max(50).optional(),
  evidence: z.array(evidenceRefSchema).max(100).optional(),
  proposal: optimizeProposalSchema.optional(),
  cannibalizationCheck: cannibalizationCheckSchema.optional(),
  merge: mergePlanSchema.optional(),
  pageSnapshot: pageSnapshotSchema.optional(),
  previewHtml: z.string().max(200_000).optional(),
  status: z.enum(["draft", "pending_approval"]).optional(),
  revisionNote: z
    .string()
    .max(2000)
    .optional()
    .describe("What you changed and why. Posted into the comment thread as your reply, so staff see it where they asked."),
} as const;

type UpdateArgs = z.infer<z.ZodObject<typeof updateInputSchema>>;

export const updateOptimizeRecommendationTool = {
  name: "update_optimize_recommendation",
  config: {
    title: "Update optimize recommendation",
    description:
      "Revise a recommendation you posted, typically after staff request changes. Send only the fields that change. A revision to a changes_requested item returns it to the review queue automatically. Include revisionNote to reply in the comment thread. Approved or finished items cannot be revised. Uses no credits.",
    inputSchema: updateInputSchema,
    outputSchema: {
      id: z.string(),
      status: z.enum(OPTIMIZE_STATUSES),
      copyRemoved: copyRemovedOutputSchema,
      ...optionalMetaOutputSchema,
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: UpdateArgs, context) => {
    const { projectId, id, agentId, agentLabel, previewHtml, ...payload } = args;
    const actor = agentActor({ agentId, agentLabel }, context.auth);

    const { removals } = await OptimizeService.updateRecommendation({
      id,
      projectId,
      actor,
      payload,
      previewHtml,
    });

    const updated = await OptimizeService.get(id, projectId);
    const meta = buildProjectMeta(context, projectId, optimizePath(projectId, id));
    return mcpResponse({
      text: [`Recommendation ${id} revised (${updated.status}).`, describeRemovals(removals)]
        .filter(Boolean)
        .join("\n"),
      meta,
      structuredContent: { id, status: updated.status, copyRemoved: removals },
    });
  }),
};

// ---------------------------------------------------------------------------
// list_optimize_recommendations / get_optimize_recommendation
// ---------------------------------------------------------------------------

const listInputSchema = {
  projectId: projectIdSchema,
  statuses: z
    .array(z.enum(OPTIMIZE_STATUSES))
    .optional()
    .describe("Filter by status. Defaults to the ones that need an agent's attention: changes_requested and pending_approval."),
  types: z.array(z.enum(OPTIMIZE_TYPES)).optional(),
  limit: z.number().int().min(1).max(200).optional(),
} as const;

type ListArgs = z.infer<z.ZodObject<typeof listInputSchema>>;

export const listOptimizeRecommendationsTool = {
  name: "list_optimize_recommendations",
  config: {
    title: "List optimize recommendations",
    description:
      "List recommendations in a project's Optimize queue. Call this at the start of a routine to find items staff have sent back with changes_requested, and to avoid proposing a URL that already has an open recommendation. Uses no credits.",
    inputSchema: listInputSchema,
    outputSchema: {
      recommendations: z.array(recommendationSummarySchema),
      ...optionalMetaOutputSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: ListArgs, context) => {
    const rows = await OptimizeService.list(args.projectId, {
      statuses: args.statuses ?? ["changes_requested", "pending_approval"],
      types: args.types,
      limit: args.limit,
    });
    const recommendations = rows.map((r) => ({
      id: r.id,
      status: r.status,
      type: r.type,
      priority: r.priority,
      targetUrl: r.targetUrl,
      primaryQuery: r.primaryQuery,
      commentCount: r.commentCount,
      lastCommentAt: r.lastCommentAt,
      createdByAgent: r.createdByAgent,
      updatedAt: r.updatedAt,
    }));
    const meta = buildProjectMeta(context, args.projectId, optimizePath(args.projectId));
    return mcpResponse({
      text: recommendations.length
        ? recommendations
            .map((r) => `- ${r.id}  ${r.status}  ${r.type}  ${r.priority}  ${r.targetUrl}${r.commentCount ? `  (${r.commentCount} comments)` : ""}`)
            .join("\n")
        : "No recommendations match.",
      meta,
      structuredContent: { recommendations },
    });
  }),
};

const getInputSchema = {
  projectId: projectIdSchema,
  id: z.string().min(1),
} as const;
type GetArgs = z.infer<z.ZodObject<typeof getInputSchema>>;

export const getOptimizeRecommendationTool = {
  name: "get_optimize_recommendation",
  config: {
    title: "Get optimize recommendation",
    description:
      "Full detail of one recommendation: proposal, evidence, cannibalization check, snapshot, execution state, and the complete comment thread. Read the comments before revising a changes_requested item. Uses no credits.",
    inputSchema: getInputSchema,
    outputSchema: {
      recommendation: z.record(z.string(), z.unknown()),
      comments: z.array(
        z.object({
          id: z.string(),
          authorType: z.enum(["user", "agent"]),
          authorLabel: z.string(),
          body: z.string(),
          createdAt: z.string(),
        }),
      ),
      ...optionalMetaOutputSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: GetArgs, context) => {
    const [recommendation, comments] = await Promise.all([
      OptimizeService.get(args.id, args.projectId),
      OptimizeService.listComments(args.id),
    ]);
    const meta = buildProjectMeta(context, args.projectId, optimizePath(args.projectId, args.id));
    const thread = comments.map((c) => ({
      id: c.id,
      authorType: c.authorType,
      authorLabel: c.authorLabel,
      body: c.body,
      createdAt: c.createdAt,
    }));
    return mcpResponse({
      text: [
        `${recommendation.id} · ${recommendation.status} · ${recommendation.type} · ${recommendation.targetUrl}`,
        recommendation.primaryQuery ? `Primary query: ${recommendation.primaryQuery}` : "",
        thread.length ? `\nComments (${thread.length}):` : "\nNo comments yet.",
        ...thread.map((c) => `[${c.createdAt}] ${c.authorLabel} (${c.authorType}): ${c.body}`),
      ]
        .filter(Boolean)
        .join("\n"),
      meta,
      structuredContent: {
        recommendation: recommendation as unknown as Record<string, unknown>,
        comments: thread,
      },
    });
  }),
};

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

const addCommentInputSchema = {
  projectId: projectIdSchema,
  id: z.string().min(1).describe("The recommendation to comment on."),
  ...agentIdentitySchema,
  body: z.string().min(1).max(10_000),
} as const;
type AddCommentArgs = z.infer<z.ZodObject<typeof addCommentInputSchema>>;

export const addOptimizeCommentTool = {
  name: "add_optimize_comment",
  config: {
    title: "Add optimize comment",
    description:
      "Reply in a recommendation's comment thread — the single conversation surface staff use. Use it to answer a question, explain a choice, or acknowledge a change request before you revise. Uses no credits.",
    inputSchema: addCommentInputSchema,
    outputSchema: { ok: z.boolean(), ...optionalMetaOutputSchema },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: AddCommentArgs, context) => {
    await OptimizeService.addComment({
      recommendationId: args.id,
      projectId: args.projectId,
      actor: agentActor(args, context.auth),
      body: args.body,
    });
    const meta = buildProjectMeta(context, args.projectId, optimizePath(args.projectId, args.id));
    return mcpResponse({ text: "Comment posted.", meta, structuredContent: { ok: true } });
  }),
};

export const listOptimizeCommentsTool = {
  name: "list_optimize_comments",
  config: {
    title: "List optimize comments",
    description: "The comment thread for one recommendation, oldest first. Uses no credits.",
    inputSchema: getInputSchema,
    outputSchema: {
      comments: z.array(
        z.object({
          id: z.string(),
          authorType: z.enum(["user", "agent"]),
          authorLabel: z.string(),
          body: z.string(),
          createdAt: z.string(),
        }),
      ),
      ...optionalMetaOutputSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: GetArgs, context) => {
    // Confirms the recommendation belongs to this project before reading.
    await OptimizeService.get(args.id, args.projectId);
    const comments = (await OptimizeService.listComments(args.id)).map((c) => ({
      id: c.id,
      authorType: c.authorType,
      authorLabel: c.authorLabel,
      body: c.body,
      createdAt: c.createdAt,
    }));
    const meta = buildProjectMeta(context, args.projectId, optimizePath(args.projectId, args.id));
    return mcpResponse({
      text: comments.length
        ? comments.map((c) => `[${c.createdAt}] ${c.authorLabel} (${c.authorType}): ${c.body}`).join("\n")
        : "No comments yet.",
      meta,
      structuredContent: { comments },
    });
  }),
};

// ---------------------------------------------------------------------------
// analyze_intent_overlap — Part H, callable
// ---------------------------------------------------------------------------

const overlapInputSchema = {
  projectId: projectIdSchema,
  query: z.string().min(2).max(300).describe("The search intent you want a page to own, e.g. 'mail management system'."),
  draftUrl: z
    .string()
    .url()
    .optional()
    .describe("The URL you intend to improve, if any; it is excluded from the list of competing pages."),
} as const;
type OverlapArgs = z.infer<z.ZodObject<typeof overlapInputSchema>>;

export const analyzeIntentOverlapTool = {
  name: "analyze_intent_overlap",
  config: {
    title: "Analyze intent overlap",
    description:
      "MUST be called before proposing a new_page_brief, and should be called before any recommendation. Scans every page from the project's latest site audit for existing pages that already target the same intent, treating near-duplicate phrasings as one intent (e.g. 'mail management system' and 'mail management solution'). Returns optimize_existing (improve that page), merge_pages (several pages compete; keep the strongest, 301 the rest) or new_page_allowed, plus a ready-to-paste cannibalizationCheck for create_optimize_recommendation. Uses no credits.",
    inputSchema: overlapInputSchema,
    outputSchema: {
      intentKey: z.string(),
      recommendation: z.enum(["optimize_existing", "merge_pages", "new_page_allowed"]),
      keepUrl: z.string().optional(),
      mergeFromUrls: z.array(z.string()).optional(),
      existingUrls: z.array(
        z.object({
          url: z.string(),
          title: z.string().nullable(),
          similarity: z.number(),
          reason: z.string(),
        }),
      ),
      cannibalizationCheck: cannibalizationCheckSchema,
      auditId: z.string().nullable(),
      pagesScanned: z.number(),
      ...optionalMetaOutputSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: OverlapArgs, context) => {
    const inventory = await OptimizeRepository.listCrawlInventoryForProject(args.projectId);
    const result = analyzeIntentOverlap({
      query: args.query,
      pages: inventory.pages,
      draftUrl: args.draftUrl,
    });
    const meta = buildProjectMeta(context, args.projectId);

    const headline =
      result.recommendation === "new_page_allowed"
        ? `No existing page owns "${args.query}" — a new page is allowed.`
        : result.recommendation === "optimize_existing"
          ? `"${args.query}" is already covered by ${result.keepUrl}. Improve that page instead of adding one.`
          : `${result.mergeFromUrls?.length ?? 0} + 1 pages compete for "${args.query}". Keep ${result.keepUrl}; merge the rest.`;

    return mcpResponse({
      text: [
        headline,
        inventory.auditId
          ? `Scanned ${inventory.pages.length} pages from audit ${inventory.auditId}.`
          : "No completed site audit for this project — run one first; this scan had nothing to compare against.",
        ...result.existingUrls.slice(0, 8).map((m) => `- ${m.similarity.toFixed(2)}  ${m.url}  ${m.title ?? ""}`),
      ].join("\n"),
      meta,
      structuredContent: {
        ...result,
        auditId: inventory.auditId,
        pagesScanned: inventory.pages.length,
      },
    });
  }),
};

// ---------------------------------------------------------------------------
// Module access — explicit, per the agent contract
// ---------------------------------------------------------------------------

const MODULES = [
  { key: "site_audit", tools: ["run_site_audit", "get_audit_status", "get_audit_issues", "get_audit_pages"] },
  { key: "search_console", tools: ["get_search_console_performance", "inspect_urls", "get_search_opportunities"] },
  { key: "google_analytics", tools: ["get_google_analytics_*"] },
  { key: "rank_tracking", tools: ["get_rank_tracker", "create_rank_tracker", "run_rank_tracker", "add_rank_tracking_keywords", "remove_rank_tracking_keywords", "estimate_rank_tracker_cost"] },
  { key: "keyword_research", tools: ["research_keywords", "get_keyword_metrics", "save_keywords", "list_saved_keywords"] },
  { key: "serp", tools: ["get_serp_results", "get_ranked_keywords", "find_serp_competitors"] },
  { key: "domain", tools: ["get_domain_overview", "get_domain_keyword_suggestions"] },
  { key: "backlinks", tools: ["get_backlinks_overview", "get_backlinks_profile"] },
  { key: "local_seo", tools: ["search_local_businesses", "get_local_serp_results", "get_business_*", "get_local_rank_grid", "list_business_categories"] },
  { key: "project_context", tools: ["get_project_context", "update_project_context"] },
  { key: "optimize", tools: ["create_optimize_recommendation", "update_optimize_recommendation", "list_optimize_recommendations", "get_optimize_recommendation", "add_optimize_comment", "list_optimize_comments", "analyze_intent_overlap"] },
] as const;

const moduleKeySchema = z.enum(MODULES.map((m) => m.key) as [string, ...string[]]);

export const listAccessibleModulesTool = {
  name: "list_accessible_modules",
  config: {
    title: "List accessible modules",
    description:
      "The modules this instance exposes and the tools in each. On this private, single-tenant instance every module a key can reach is granted to it; call request_module_access to record which modules your routine intends to read, so the audit trail shows what you used. Uses no credits.",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: {
      modules: z.array(z.object({ key: z.string(), granted: z.boolean(), tools: z.array(z.string()) })),
      ...optionalMetaOutputSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const modules = MODULES.map((m) => ({ key: m.key, granted: true, tools: [...m.tools] }));
    return mcpResponse({
      text: modules.map((m) => `- ${m.key}: granted (${m.tools.join(", ")})`).join("\n"),
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: { modules },
    });
  }),
};

const requestAccessInputSchema = {
  projectId: projectIdSchema,
  ...agentIdentitySchema,
  modules: z.array(moduleKeySchema).min(1).max(20).describe("The modules this routine will read."),
  reason: z.string().max(500).optional().describe("One line on what the routine is for."),
} as const;
type RequestAccessArgs = z.infer<z.ZodObject<typeof requestAccessInputSchema>>;

export const requestModuleAccessTool = {
  name: "request_module_access",
  config: {
    title: "Request module access",
    description:
      "Declare which modules your routine is about to read. On this instance access is granted immediately; the declaration is logged with your agent identity so staff can see what each routine touched. Call it once at the start of a routine, before reading data. Uses no credits.",
    inputSchema: requestAccessInputSchema,
    outputSchema: {
      granted: z.array(z.string()),
      denied: z.array(z.string()),
      ...optionalMetaOutputSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: RequestAccessArgs, context) => {
    const actor = agentActor(args, context.auth);
    // Server log is the trail for v1; a per-key grant store is the upgrade
    // path if this instance ever becomes multi-tenant.
    console.log(
      `[optimize] module access declared by ${actor.id} (${actor.label}) for project ${args.projectId}: ${args.modules.join(", ")}${args.reason ? ` — ${args.reason}` : ""}`,
    );
    return mcpResponse({
      text: `Granted: ${args.modules.join(", ")}.`,
      meta: buildProjectMeta(context, args.projectId),
      structuredContent: { granted: [...args.modules], denied: [] },
    });
  }),
};
