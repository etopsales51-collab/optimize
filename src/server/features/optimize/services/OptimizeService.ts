/**
 * Optimize business rules: the approval state machine and Part H.
 *
 * Two invariants live here and nowhere else:
 *
 *  1. Nothing reaches WordPress that a human did not approve. Execution reads
 *     `approved` only, and only `pending_approval` can become `approved`.
 *  2. No agent may create a new page when an existing one already covers the
 *     intent. Enforced on every create and every revision, because a proposal
 *     can be edited into a violation after it was first accepted.
 *
 * Agents are external callers, so payloads are parsed with Zod here rather than
 * trusted from the caller, and preview markup is sanitized before storage.
 */
import { AppError } from "@/server/lib/errors";
import {
  canApprove,
  canTransition,
  createRecommendationSchema,
  newPageBriefAllowed,
  updateRecommendationSchema,
  type CannibalizationCheck,
  type OptimizeStatus,
  type OptimizeType,
} from "@/shared/optimize";
import { OptimizeRepository } from "../repositories/OptimizeRepository";
import { sanitizePreviewHtml } from "../previewSanitizer";

export type AgentActor = { type: "agent"; id: string; label: string };
export type UserActor = { type: "user"; id: string; label: string };
export type Actor = AgentActor | UserActor;

function actorKey(actor: Actor): string {
  return `${actor.type}:${actor.id}`;
}

/**
 * Part H, enforced rather than advised.
 *
 * A `new_page_brief` is only allowed when the overlap scan came back clear. The
 * failure this prevents is two URLs competing for one intent — "mail management
 * system" and "mail management solution" are the same intent and must not
 * become two pages. When overlap exists the agent must improve the existing
 * page or merge; adding a third is never the answer.
 *
 * The error names the alternative so the agent can correct itself without a
 * round-trip through a human.
 */
function assertCannibalizationRules(
  type: OptimizeType,
  check: CannibalizationCheck,
) {
  if (type !== "new_page_brief") return;

  if (!newPageBriefAllowed(check)) {
    const urls = check.overlappingUrls.map((row) => row.url).slice(0, 5);
    throw new AppError(
      "VALIDATION_ERROR",
      `A new page is not allowed while existing pages cover this intent. ` +
        `Use content_refresh or on_page on the strongest existing URL, or ` +
        `merge_pages if several compete. Overlapping: ${
          urls.length ? urls.join(", ") : "(cannibalizationCheck not clear)"
        }`,
    );
  }
}

/** A merge proposal is meaningless without the pages it merges. */
function assertMergeShape(
  type: OptimizeType,
  merge: { keepUrl: string; mergeFromUrls: string[] } | null | undefined,
) {
  if (type !== "merge_pages") return;
  if (!merge || merge.mergeFromUrls.length === 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      "merge_pages requires `merge` with keepUrl and at least one mergeFromUrl.",
    );
  }
  if (merge.mergeFromUrls.includes(merge.keepUrl)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "merge.keepUrl must not also appear in merge.mergeFromUrls.",
    );
  }
}

function assertTransition(from: OptimizeStatus, to: OptimizeStatus) {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new AppError(
      "CONFLICT",
      `Cannot move a recommendation from ${from} to ${to}.`,
    );
  }
}

async function loadOrThrow(id: string, projectId: string) {
  const row = await OptimizeRepository.getRecommendation(id, projectId);
  if (!row) throw new AppError("NOT_FOUND", "Recommendation not found.");
  return row;
}

// ---------------------------------------------------------------------------
// Agent writes
// ---------------------------------------------------------------------------

async function createRecommendation(input: {
  projectId: string;
  domain: string | null;
  actor: AgentActor;
  payload: unknown;
  previewHtml?: string | null;
}) {
  const data = createRecommendationSchema.parse(input.payload);

  assertCannibalizationRules(data.type, data.cannibalizationCheck);
  assertMergeShape(data.type, data.merge);

  const id = crypto.randomUUID();

  await OptimizeRepository.createRecommendation({
    id,
    projectId: input.projectId,
    domain: input.domain,
    status: data.status,
    priority: data.priority,
    type: data.type,
    targetUrl: data.targetUrl,
    canonicalPath: safePath(data.targetUrl),
    primaryQuery: data.primaryQuery ?? null,
    secondaryQueries: data.secondaryQueries,
    merge: data.merge ?? null,
    evidence: data.evidence,
    proposal: data.proposal,
    cannibalizationCheck: data.cannibalizationCheck,
    pageSnapshot: data.pageSnapshot ?? null,
    previewHtml: sanitizePreviewHtml(input.previewHtml) || null,
    createdByAgent: input.actor.id,
  });

  await OptimizeRepository.addJobEvent({
    id: crypto.randomUUID(),
    recommendationId: id,
    eventType: "created",
    actor: actorKey(input.actor),
    detail: { type: data.type, status: data.status, targetUrl: data.targetUrl },
  });

  return id;
}

/**
 * Agent revision, typically answering `changes_requested`.
 *
 * Rules are re-checked against the MERGED result, not the patch: a proposal
 * that was clear on create could be edited into a cannibalizing new page, and
 * validating only the incoming fields would miss it.
 */
async function updateRecommendation(input: {
  id: string;
  projectId: string;
  actor: AgentActor;
  payload: unknown;
  previewHtml?: string | null;
}) {
  const existing = await loadOrThrow(input.id, input.projectId);
  const patch = updateRecommendationSchema.parse(input.payload);

  const nextType = patch.type ?? existing.type;
  const nextCheck =
    patch.cannibalizationCheck ??
    existing.cannibalizationCheck ?? {
      status: "overlap_found" as const,
      method: "manual" as const,
      overlappingUrls: [],
      notes: "No cannibalization check on record.",
    };
  const nextMerge = patch.merge ?? existing.merge;

  assertCannibalizationRules(nextType, nextCheck);
  assertMergeShape(nextType, nextMerge);

  // A revision to something staff asked to change goes back into the queue.
  // Anything already approved or finished is immutable — an agent must not be
  // able to swap the content out from under an approval.
  let nextStatus: OptimizeStatus | undefined;
  if (patch.status && patch.status !== existing.status) {
    assertTransition(existing.status, patch.status);
    nextStatus = patch.status;
  } else if (existing.status === "changes_requested") {
    nextStatus = "pending_approval";
  } else if (
    existing.status !== "draft" &&
    existing.status !== "pending_approval"
  ) {
    throw new AppError(
      "CONFLICT",
      `A recommendation in ${existing.status} can no longer be revised.`,
    );
  }

  await OptimizeRepository.updateRecommendation(input.id, input.projectId, {
    status: nextStatus,
    priority: patch.priority,
    type: patch.type,
    targetUrl: patch.targetUrl,
    primaryQuery: patch.primaryQuery,
    secondaryQueries: patch.secondaryQueries,
    merge: patch.merge,
    evidence: patch.evidence,
    proposal: patch.proposal,
    cannibalizationCheck: patch.cannibalizationCheck,
    pageSnapshot: patch.pageSnapshot,
    previewHtml:
      input.previewHtml === undefined
        ? undefined
        : sanitizePreviewHtml(input.previewHtml) || null,
  });

  // The revision note becomes the agent's turn in the thread, so staff see what
  // changed in the same place they asked for it.
  if (patch.revisionNote) {
    await addComment({
      recommendationId: input.id,
      projectId: input.projectId,
      actor: input.actor,
      body: patch.revisionNote,
    });
  }

  await OptimizeRepository.addJobEvent({
    id: crypto.randomUUID(),
    recommendationId: input.id,
    eventType: "revised",
    actor: actorKey(input.actor),
    detail: { from: existing.status, to: nextStatus ?? existing.status },
  });
}

// ---------------------------------------------------------------------------
// Staff actions
// ---------------------------------------------------------------------------

async function requestChanges(input: {
  id: string;
  projectId: string;
  actor: UserActor;
  body: string;
}) {
  const existing = await loadOrThrow(input.id, input.projectId);
  assertTransition(existing.status, "changes_requested");

  await OptimizeRepository.updateRecommendation(input.id, input.projectId, {
    status: "changes_requested",
  });

  await addComment({
    recommendationId: input.id,
    projectId: input.projectId,
    actor: input.actor,
    body: input.body,
  });

  await OptimizeRepository.addJobEvent({
    id: crypto.randomUUID(),
    recommendationId: input.id,
    eventType: "changes_requested",
    actor: actorKey(input.actor),
  });
}

/**
 * The gate. Everything downstream of here can mutate a live site, so this is
 * the one place a human decision is recorded.
 *
 * Part H is re-validated at approval time: the proposal may have been revised
 * since it was created, and the check that mattered is the one true now.
 */
async function approve(input: {
  id: string;
  projectId: string;
  actor: UserActor;
}) {
  const existing = await loadOrThrow(input.id, input.projectId);

  if (!canApprove(existing.status)) {
    throw new AppError(
      "CONFLICT",
      `Only a recommendation awaiting review can be approved; this one is ${existing.status}.`,
    );
  }

  if (existing.cannibalizationCheck) {
    assertCannibalizationRules(existing.type, existing.cannibalizationCheck);
  } else if (existing.type === "new_page_brief") {
    throw new AppError(
      "VALIDATION_ERROR",
      "This new page brief has no cannibalization check on record and cannot be approved.",
    );
  }
  assertMergeShape(existing.type, existing.merge);

  const approvedAt = new Date().toISOString();
  await OptimizeRepository.updateRecommendation(input.id, input.projectId, {
    status: "approved",
    approvedByUserId: input.actor.id,
    approvedAt,
  });

  await OptimizeRepository.addJobEvent({
    id: crypto.randomUUID(),
    recommendationId: input.id,
    eventType: "approved",
    actor: actorKey(input.actor),
    detail: { approvedAt },
  });
}

async function dismiss(input: {
  id: string;
  projectId: string;
  actor: UserActor;
  reason?: string;
}) {
  const existing = await loadOrThrow(input.id, input.projectId);
  assertTransition(existing.status, "dismissed");

  await OptimizeRepository.updateRecommendation(input.id, input.projectId, {
    status: "dismissed",
    dismissedReason: input.reason ?? null,
  });

  await OptimizeRepository.addJobEvent({
    id: crypto.randomUUID(),
    recommendationId: input.id,
    eventType: "dismissed",
    actor: actorKey(input.actor),
    detail: input.reason ? { reason: input.reason } : undefined,
  });
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

async function addComment(input: {
  recommendationId: string;
  projectId: string;
  actor: Actor;
  body: string;
}) {
  // Confirms the recommendation belongs to this project before writing a
  // comment against its id.
  await loadOrThrow(input.recommendationId, input.projectId);

  await OptimizeRepository.addComment({
    id: crypto.randomUUID(),
    recommendationId: input.recommendationId,
    authorType: input.actor.type,
    authorId: input.actor.id,
    authorLabel: input.actor.label,
    body: input.body,
  });
}

/** Path only, for grouping by page. Never throws on a malformed URL. */
function safePath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

export const OptimizeService = {
  createRecommendation,
  updateRecommendation,
  requestChanges,
  approve,
  dismiss,
  addComment,
  get: loadOrThrow,
  list: OptimizeRepository.listRecommendations,
  listComments: OptimizeRepository.listComments,
  listJobEvents: OptimizeRepository.listJobEvents,
  countByStatus: OptimizeRepository.countByStatus,
} as const;
