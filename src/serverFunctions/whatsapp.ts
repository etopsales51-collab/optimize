import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { WhatsappRepository } from "@/server/features/whatsapp/WhatsappRepository";
import {
  recipientView,
  WhatsappService,
} from "@/server/features/whatsapp/WhatsappService";
import { MAX_BODY_CHARS } from "@/server/features/whatsapp/whatsappRules";
import { requireProjectContext } from "@/serverFunctions/middleware";

/**
 * The WhatsApp page. The channel belongs to the organization, so every call
 * works on the caller's organization; the project in the URL only decides
 * whether the page shows this project's alerts or every project's.
 *
 * Owners and admins only: it pages real phones and lists team numbers, which is
 * the same standing as setting publishing credentials.
 */

const projectScoped = z.object({ projectId: z.string().min(1) });
const scope = z.enum(["project", "all"]).default("project");

type Ctx = Parameters<typeof requireOrgPermission>[0] & {
  organizationId: string;
  projectId: string;
  userId: string;
};

function gate(context: Ctx) {
  requireOrgPermission(context, { member: ["update"] });
}

const projectFilter = (context: Ctx, value: "project" | "all") =>
  value === "project" ? context.projectId : null;

export const getWhatsappOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ scope }))
  .handler(async ({ data, context }) => {
    gate(context);
    const [status, conversations] = await Promise.all([
      WhatsappService.getConnectionStatus(),
      WhatsappService.listConversations({
        organizationId: context.organizationId,
        projectId: projectFilter(context, data.scope),
      }),
    ]);
    return { status, conversations };
  });

export const getWhatsappThread = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ scope, recipientId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    gate(context);
    return WhatsappService.listThread({
      organizationId: context.organizationId,
      recipientId: data.recipientId,
      projectId: projectFilter(context, data.scope),
    });
  });

export const sendWhatsappMessage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      recipientId: z.string().min(1),
      body: z.string().trim().min(1).max(MAX_BODY_CHARS),
      // Tag the message with this project so it shows under its filter.
      tagProject: z.boolean().default(false),
    }),
  )
  .handler(async ({ data, context }) => {
    gate(context);
    return WhatsappService.sendToRecipient({
      organizationId: context.organizationId,
      recipientId: data.recipientId,
      body: data.body,
      projectId: data.tagProject ? context.projectId : null,
      author: "user",
      createdBy: context.userId,
    });
  });

export const addWhatsappRecipient = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      name: z.string().trim().min(1).max(80),
      phone: z.string().trim().min(6).max(30),
    }),
  )
  .handler(async ({ data, context }) => {
    gate(context);
    const id = await WhatsappService.addRecipient({
      organizationId: context.organizationId,
      name: data.name,
      phone: data.phone,
    });
    return { id };
  });

export const updateWhatsappRecipient = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScoped.extend({
      recipientId: z.string().min(1),
      name: z.string().trim().min(1).max(80).optional(),
      enabled: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    gate(context);
    await WhatsappRepository.updateRecipient(
      context.organizationId,
      data.recipientId,
      {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      },
    );
    const row = await WhatsappRepository.getRecipient(
      context.organizationId,
      data.recipientId,
    );
    return row ? recipientView(row) : null;
  });

export const removeWhatsappRecipient = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScoped.extend({ recipientId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    gate(context);
    await WhatsappRepository.deleteRecipient(
      context.organizationId,
      data.recipientId,
    );
    return { ok: true };
  });
