import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { OptimizeService } from "@/server/features/optimize/services/OptimizeService";
import {
  addCommentSchema,
  requestChangesSchema,
  OPTIMIZE_STATUSES,
  OPTIMIZE_TYPES,
} from "@/shared/optimize";
import { requireProjectContext } from "@/serverFunctions/middleware";

/**
 * Staff-facing Optimize surface. Everything here runs as the signed-in user
 * inside a project they already hold, via requireProjectContext — so no handler
 * needs to re-check ownership, and no id from the client can reach another
 * project's rows.
 *
 * Agents do NOT come through here; they use the MCP tools and the inbound
 * webhook. Keeping the two entry points separate is what makes "staff approve,
 * agents propose" enforceable rather than conventional.
 */

const projectScopedSchema = z.object({ projectId: z.string().min(1) });

const listSchema = projectScopedSchema.extend({
  statuses: z.array(z.enum(OPTIMIZE_STATUSES)).optional(),
  types: z.array(z.enum(OPTIMIZE_TYPES)).optional(),
});

const recommendationScopedSchema = projectScopedSchema.extend({
  id: z.string().min(1),
});

/** The label staff see on their own comments in the thread. */
function userActor(context: { userId: string; userEmail: string }) {
  return {
    type: "user" as const,
    id: context.userId,
    label: context.userEmail,
  };
}

export const listOptimizeRecommendations = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listSchema)
  .handler(async ({ data, context }) => {
    const [items, counts] = await Promise.all([
      OptimizeService.list(context.projectId, {
        statuses: data.statuses,
        types: data.types,
      }),
      OptimizeService.countByStatus(context.projectId),
    ]);
    return { items, counts };
  });

export const getOptimizeRecommendation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(recommendationScopedSchema)
  .handler(async ({ data, context }) => {
    const [recommendation, comments, events] = await Promise.all([
      OptimizeService.get(data.id, context.projectId),
      OptimizeService.listComments(data.id),
      OptimizeService.listJobEvents(data.id),
    ]);
    return { recommendation, comments, events };
  });

export const addOptimizeComment = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(recommendationScopedSchema.extend(addCommentSchema.shape))
  .handler(async ({ data, context }) => {
    await OptimizeService.addComment({
      recommendationId: data.id,
      projectId: context.projectId,
      actor: userActor(context),
      body: data.body,
    });
    return { ok: true };
  });

export const requestOptimizeChanges = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(recommendationScopedSchema.extend(requestChangesSchema.shape))
  .handler(async ({ data, context }) => {
    await OptimizeService.requestChanges({
      id: data.id,
      projectId: context.projectId,
      actor: userActor(context),
      body: data.body,
    });
    return { ok: true };
  });

/**
 * The approval gate. This records the human decision and nothing more — wiring
 * it to NovaMira / WP REST comes with the execution layer, and until then an
 * approved item simply sits in `approved`.
 */
export const approveOptimizeRecommendation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(recommendationScopedSchema)
  .handler(async ({ data, context }) => {
    await OptimizeService.approve({
      id: data.id,
      projectId: context.projectId,
      actor: userActor(context),
    });
    return { ok: true };
  });

export const dismissOptimizeRecommendation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    recommendationScopedSchema.extend({
      reason: z.string().max(1000).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    await OptimizeService.dismiss({
      id: data.id,
      projectId: context.projectId,
      actor: userActor(context),
      reason: data.reason,
    });
    return { ok: true };
  });
