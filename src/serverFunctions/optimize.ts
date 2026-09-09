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
import {
  getSettingsView,
  previewPublish,
  publishApproved,
  saveSettings,
  testConnections,
} from "@/server/features/optimize/publish/publishService";
import { requireOrgPermission } from "@/server/auth/org-gate";

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

/**
 * Put a failed publish back into `approved` so it can be tried again after the
 * cause is fixed — usually a credential corrected in Project settings.
 * Publishing then re-runs every gate; this does not skip any of them.
 */
export const retryOptimizePublish = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(recommendationScopedSchema)
  .handler(async ({ data, context }) => {
    await OptimizeService.retryPublish({
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

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export const getPublishSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => getSettingsView(context.projectId));

/**
 * Only an org admin or owner may set publishing credentials — this is the
 * control that lets the app write to a live store, so it sits behind the same
 * standing as managing the team. The password is write-only: an empty string
 * leaves the stored one untouched, and it is never read back to the client.
 */
export const savePublishSettings = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScopedSchema.extend({
      wordpressBaseUrl: z.string().url().or(z.literal("")).optional(),
      wpUsername: z.string().max(200).optional(),
      wpAppPassword: z.string().max(500).optional(),
      wooConsumerKey: z.string().max(200).optional(),
      wooConsumerSecret: z.string().max(200).optional(),
      pagesChannel: z.enum(["novamira", "wp_rest", "manual"]).optional(),
      productsChannel: z.enum(["novamira", "wp_rest", "manual"]).optional(),
      publishingEnabled: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { member: ["update"] });
    await saveSettings({
      projectId: context.projectId,
      wordpressBaseUrl: data.wordpressBaseUrl === "" ? null : data.wordpressBaseUrl,
      wpUsername: data.wpUsername,
      wpAppPassword: data.wpAppPassword,
      wooConsumerKey: data.wooConsumerKey,
      wooConsumerSecret: data.wooConsumerSecret,
      pagesChannel: data.pagesChannel,
      productsChannel: data.productsChannel,
      publishingEnabled: data.publishingEnabled,
    });
    return getSettingsView(context.projectId);
  });

/**
 * Verify the stored credentials against the live site, read-only.
 *
 * Exists so a credential can be checked without anyone pasting it into a chat
 * or an email — the secret stays sealed server-side and only a verdict comes
 * back. Same permission as saving them.
 */
export const testPublishConnections = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { member: ["update"] });
    return { checks: await testConnections(context.projectId) };
  });

/** What publishing would change. Touches nothing. */
export const previewOptimizePublish = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(recommendationScopedSchema)
  .handler(async ({ data, context }) =>
    previewPublish(data.id, context.projectId),
  );

/**
 * Publish an approved recommendation to the live site.
 *
 * Separate from approve on purpose: approving records the human decision, and
 * this is the deliberate second action that writes. The service re-checks that
 * the item is `approved` regardless of who calls this.
 */
export const publishOptimizeRecommendation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(recommendationScopedSchema)
  .handler(async ({ data, context }) =>
    publishApproved({
      recommendationId: data.id,
      projectId: context.projectId,
      actorKey: `user:${context.userId}`,
    }),
  );
