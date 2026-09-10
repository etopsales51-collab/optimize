/**
 * Data access for the Optimize tables.
 * Provider-aware (D1 or Postgres) via the `@/db` handle.
 *
 * Rows are stored with their agent-authored payloads as JSON text. This layer
 * hands back the raw row plus parsed payloads; it does not validate them —
 * validation happens once, at the trust boundary, in OptimizeService. Reading a
 * malformed payload written before a schema change should degrade to a default
 * rather than throw in a list view, so the parse helpers below are total.
 */
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  auditPages,
  audits,
  optimizeComments,
  optimizeJobEvents,
  optimizeRecommendations,
} from "@/db/schema";
import type {
  CannibalizationCheck,
  EvidenceRef,
  ExecutionState,
  MergePlan,
  OptimizePriority,
  OptimizeProposal,
  OptimizeStatus,
  OptimizeType,
  PageSnapshot,
} from "@/shared/optimize";

type RecommendationRow = typeof optimizeRecommendations.$inferSelect;

/** Never throws: a bad stored payload must not break a list render. */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export type OptimizeRecommendationRecord = Omit<
  RecommendationRow,
  | "secondaryQueriesJson"
  | "mergeJson"
  | "evidenceJson"
  | "proposalJson"
  | "cannibalizationCheckJson"
  | "pageSnapshotJson"
  | "executionJson"
> & {
  secondaryQueries: string[];
  merge: MergePlan | null;
  evidence: EvidenceRef[];
  proposal: OptimizeProposal;
  cannibalizationCheck: CannibalizationCheck | null;
  pageSnapshot: PageSnapshot | null;
  execution: ExecutionState;
};

function hydrate(row: RecommendationRow): OptimizeRecommendationRecord {
  const {
    secondaryQueriesJson,
    mergeJson,
    evidenceJson,
    proposalJson,
    cannibalizationCheckJson,
    pageSnapshotJson,
    executionJson,
    ...rest
  } = row;

  return {
    ...rest,
    secondaryQueries: parseJson<string[]>(secondaryQueriesJson, []),
    merge: parseJson<MergePlan | null>(mergeJson, null),
    evidence: parseJson<EvidenceRef[]>(evidenceJson, []),
    proposal: parseJson<OptimizeProposal>(proposalJson, {
      sections: [],
      internalLinks: [],
      attachments: [],
      notes: "",
    }),
    cannibalizationCheck: parseJson<CannibalizationCheck | null>(
      cannibalizationCheckJson,
      null,
    ),
    pageSnapshot: parseJson<PageSnapshot | null>(pageSnapshotJson, null),
    execution: parseJson<ExecutionState>(executionJson, { channel: "manual" }),
  };
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

async function createRecommendation(data: {
  id: string;
  projectId: string;
  domain: string | null;
  status: OptimizeStatus;
  priority: OptimizePriority;
  type: OptimizeType;
  targetUrl: string;
  canonicalPath: string | null;
  primaryQuery: string | null;
  secondaryQueries: string[];
  merge: MergePlan | null;
  evidence: EvidenceRef[];
  proposal: OptimizeProposal;
  cannibalizationCheck: CannibalizationCheck;
  pageSnapshot: PageSnapshot | null;
  previewHtml: string | null;
  createdByAgent: string;
}) {
  const now = new Date().toISOString();
  await db.insert(optimizeRecommendations).values({
    id: data.id,
    projectId: data.projectId,
    domain: data.domain,
    status: data.status,
    priority: data.priority,
    type: data.type,
    targetUrl: data.targetUrl,
    canonicalPath: data.canonicalPath,
    primaryQuery: data.primaryQuery,
    secondaryQueriesJson: JSON.stringify(data.secondaryQueries),
    mergeJson: data.merge ? JSON.stringify(data.merge) : null,
    evidenceJson: JSON.stringify(data.evidence),
    proposalJson: JSON.stringify(data.proposal),
    cannibalizationCheckJson: JSON.stringify(data.cannibalizationCheck),
    pageSnapshotJson: data.pageSnapshot
      ? JSON.stringify(data.pageSnapshot)
      : null,
    previewHtml: data.previewHtml,
    executionJson: JSON.stringify({ channel: "manual" }),
    createdByAgent: data.createdByAgent,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Partial update. Only the fields present are written, so an agent revising a
 * title does not blank out the evidence it gathered earlier.
 */
async function updateRecommendation(
  id: string,
  projectId: string,
  patch: {
    status?: OptimizeStatus;
    priority?: OptimizePriority;
    type?: OptimizeType;
    targetUrl?: string;
    canonicalPath?: string | null;
    primaryQuery?: string | null;
    secondaryQueries?: string[];
    merge?: MergePlan | null;
    evidence?: EvidenceRef[];
    proposal?: OptimizeProposal;
    cannibalizationCheck?: CannibalizationCheck;
    pageSnapshot?: PageSnapshot | null;
    previewHtml?: string | null;
    execution?: ExecutionState;
    approvedByUserId?: string | null;
    approvedAt?: string | null;
    dismissedReason?: string | null;
  },
) {
  const values: Partial<typeof optimizeRecommendations.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (patch.status !== undefined) values.status = patch.status;
  if (patch.priority !== undefined) values.priority = patch.priority;
  if (patch.type !== undefined) values.type = patch.type;
  if (patch.targetUrl !== undefined) values.targetUrl = patch.targetUrl;
  if (patch.canonicalPath !== undefined)
    values.canonicalPath = patch.canonicalPath;
  if (patch.primaryQuery !== undefined)
    values.primaryQuery = patch.primaryQuery;
  if (patch.secondaryQueries !== undefined)
    values.secondaryQueriesJson = JSON.stringify(patch.secondaryQueries);
  if (patch.merge !== undefined)
    values.mergeJson = patch.merge ? JSON.stringify(patch.merge) : null;
  if (patch.evidence !== undefined)
    values.evidenceJson = JSON.stringify(patch.evidence);
  if (patch.proposal !== undefined)
    values.proposalJson = JSON.stringify(patch.proposal);
  if (patch.cannibalizationCheck !== undefined)
    values.cannibalizationCheckJson = JSON.stringify(
      patch.cannibalizationCheck,
    );
  if (patch.pageSnapshot !== undefined)
    values.pageSnapshotJson = patch.pageSnapshot
      ? JSON.stringify(patch.pageSnapshot)
      : null;
  if (patch.previewHtml !== undefined) values.previewHtml = patch.previewHtml;
  if (patch.execution !== undefined)
    values.executionJson = JSON.stringify(patch.execution);
  if (patch.approvedByUserId !== undefined)
    values.approvedByUserId = patch.approvedByUserId;
  if (patch.approvedAt !== undefined) values.approvedAt = patch.approvedAt;
  if (patch.dismissedReason !== undefined)
    values.dismissedReason = patch.dismissedReason;

  await db
    .update(optimizeRecommendations)
    .set(values)
    // projectId is in the predicate on every mutation: an id alone must never
    // be enough to write across a project boundary.
    .where(
      and(
        eq(optimizeRecommendations.id, id),
        eq(optimizeRecommendations.projectId, projectId),
      ),
    );
}

async function getRecommendation(id: string, projectId: string) {
  const rows = await db
    .select()
    .from(optimizeRecommendations)
    .where(
      and(
        eq(optimizeRecommendations.id, id),
        eq(optimizeRecommendations.projectId, projectId),
      ),
    )
    .limit(1);

  return rows[0] ? hydrate(rows[0]) : null;
}

async function listRecommendations(
  projectId: string,
  filters: {
    statuses?: OptimizeStatus[];
    types?: OptimizeType[];
    limit?: number;
  } = {},
) {
  const conditions = [eq(optimizeRecommendations.projectId, projectId)];
  if (filters.statuses?.length) {
    conditions.push(inArray(optimizeRecommendations.status, filters.statuses));
  }
  if (filters.types?.length) {
    conditions.push(inArray(optimizeRecommendations.type, filters.types));
  }

  const rows = await db
    .select()
    .from(optimizeRecommendations)
    .where(and(...conditions))
    .orderBy(desc(optimizeRecommendations.updatedAt))
    .limit(Math.min(filters.limit ?? 100, 200));

  return rows.map(hydrate);
}

async function countByStatus(projectId: string) {
  const rows = await db
    .select({
      status: optimizeRecommendations.status,
      total: count(),
    })
    .from(optimizeRecommendations)
    .where(eq(optimizeRecommendations.projectId, projectId))
    .groupBy(optimizeRecommendations.status);

  return rows;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

async function addComment(data: {
  id: string;
  recommendationId: string;
  authorType: "user" | "agent";
  authorId: string;
  authorLabel: string;
  body: string;
}) {
  const now = new Date().toISOString();

  await db.insert(optimizeComments).values({ ...data, createdAt: now });

  // Denormalized so the list view can show an unread badge without joining
  // every thread. Recomputed from the table rather than incremented so a
  // retried write cannot drift the count.
  const [{ total }] = await db
    .select({ total: count() })
    .from(optimizeComments)
    .where(eq(optimizeComments.recommendationId, data.recommendationId));

  await db
    .update(optimizeRecommendations)
    .set({ commentCount: total, lastCommentAt: now, updatedAt: now })
    .where(eq(optimizeRecommendations.id, data.recommendationId));
}

async function listComments(recommendationId: string) {
  return db
    .select()
    .from(optimizeComments)
    .where(eq(optimizeComments.recommendationId, recommendationId))
    .orderBy(optimizeComments.createdAt);
}

// ---------------------------------------------------------------------------
// Job events (append-only audit trail)
// ---------------------------------------------------------------------------

async function addJobEvent(data: {
  id: string;
  recommendationId: string;
  eventType: string;
  actor: string;
  detail?: Record<string, unknown>;
}) {
  await db.insert(optimizeJobEvents).values({
    id: data.id,
    recommendationId: data.recommendationId,
    eventType: data.eventType,
    actor: data.actor,
    detailJson: JSON.stringify(data.detail ?? {}),
    createdAt: new Date().toISOString(),
  });
}

async function listJobEvents(recommendationId: string) {
  return db
    .select()
    .from(optimizeJobEvents)
    .where(eq(optimizeJobEvents.recommendationId, recommendationId))
    .orderBy(desc(optimizeJobEvents.createdAt))
    .limit(200);
}


// ---------------------------------------------------------------------------
// Crawl inventory (read-only view over the latest site audit)
// ---------------------------------------------------------------------------

/**
 * Every page the most recent audit fetched, with the fields the overlap scan
 * needs. Lives here rather than widening AuditRepository.getPagesForAudit so
 * the Optimize feature owns its own query and upstream merges stay clean.
 *
 * Redirect-source rows are returned as-is (statusCode 3xx + redirectUrl) and
 * filtered by the caller: the crawler records /path and /path/ separately on
 * purpose, and only the 200 row is a page.
 */
async function listCrawlInventoryForProject(projectId: string) {
  const latest = await db.query.audits.findFirst({
    where: eq(audits.projectId, projectId),
    orderBy: desc(audits.startedAt),
    columns: { id: true, startedAt: true, status: true },
  });
  if (!latest) return { auditId: null, startedAt: null, pages: [] };

  const pages = await db
    .select({
      id: auditPages.id,
      url: auditPages.url,
      statusCode: auditPages.statusCode,
      redirectUrl: auditPages.redirectUrl,
      fetchClass: auditPages.fetchClass,
      title: auditPages.title,
      ogTitle: auditPages.ogTitle,
      metaDescription: auditPages.metaDescription,
      inSitemap: auditPages.inSitemap,
      internalLinkCount: auditPages.internalLinkCount,
      wordCount: auditPages.wordCount,
    })
    .from(auditPages)
    .where(eq(auditPages.auditId, latest.id));

  return { auditId: latest.id, startedAt: latest.startedAt, pages };
}

export const OptimizeRepository = {
  createRecommendation,
  updateRecommendation,
  getRecommendation,
  listRecommendations,
  countByStatus,
  addComment,
  listComments,
  addJobEvent,
  listJobEvents,
  listCrawlInventoryForProject,
} as const;
