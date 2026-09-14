import { z } from "zod";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { WhatsappRepository } from "@/server/features/whatsapp/WhatsappRepository";
import { WhatsappService } from "@/server/features/whatsapp/WhatsappService";
import { MAX_BODY_CHARS } from "@/server/features/whatsapp/whatsappRules";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

/**
 * The team WhatsApp channel, for agents.
 *
 * An agent reads what the team said and writes back to them. It does not
 * approve anything here: approval stays a person's action in Optimize, so the
 * way to "seek approval" is to file the recommendation, then message its link.
 */

const whatsappPath = (projectId: string) => `/p/${projectId}/whatsapp`;

const listInputSchema = {
  projectId: projectIdSchema,
  scope: z
    .enum(["project", "all"])
    .optional()
    .describe("all (default): the whole organization's channel. project: only messages tagged with this project."),
  since: z
    .string()
    .datetime()
    .optional()
    .describe("ISO timestamp. Only messages at or after it — pass the createdAt of the last message you handled."),
  limit: z.number().int().min(1).max(200).optional().describe("Default 50, newest first."),
} as const;

export const listWhatsappMessagesTool = {
  name: "list_whatsapp_messages",
  config: {
    title: "List WhatsApp messages",
    description:
      "Read the team's WhatsApp channel: alerts the app sent (keyword drops, critical audit issues, approvals needed, publish results) and what the team replied. Use it at the start of a routine to pick up instructions, and pass `since` to see only what is new. Messages from the team have direction 'in' and author 'recipient'. Uses no credits.",
    inputSchema: listInputSchema,
    outputSchema: {
      messages: z.array(looseObjectOutputSchema),
      recipients: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof listInputSchema>>, context) => {
      requireOrgPermission(context.auth, { member: ["update"] });
      const organizationId = context.auth.organizationId;
      const [messages, recipientRows] = await Promise.all([
        WhatsappService.listRecentForAgent({
          organizationId,
          projectId: args.scope === "project" ? args.projectId : null,
          since: args.since ?? null,
          limit: args.limit ?? 50,
        }),
        WhatsappRepository.listRecipients(organizationId),
      ]);
      const recipients = recipientRows.map((row) => ({
        id: row.id,
        name: row.name,
        enabled: row.enabled,
      }));

      const text = messages.length
        ? messages
            .map(
              (m) =>
                `- ${m.createdAt} ${m.direction === "in" ? `${m.recipientName ?? "?"} →` : `→ ${m.recipientName ?? "?"}`}${m.projectName ? ` [${m.projectName}]` : ""}${m.alertType ? ` (${m.alertType})` : ""}: ${m.body.replace(/\s+/g, " ").slice(0, 280)}`,
            )
            .join("\n")
        : "No messages match.";

      return mcpResponse({
        text,
        meta: buildProjectMeta(context, args.projectId, whatsappPath(args.projectId)),
        structuredContent: { messages, recipients },
      });
    },
  ),
};

const sendInputSchema = {
  projectId: projectIdSchema,
  body: z
    .string()
    .min(1)
    .max(MAX_BODY_CHARS)
    .describe("Plain text, short enough to read on a phone. To ask for approval, file the Optimize recommendation first and include its link."),
  recipientIds: z
    .array(z.string())
    .max(20)
    .optional()
    .describe("Who to message. Omit to message every enabled recipient. Ids come from list_whatsapp_messages."),
  tagProject: z
    .boolean()
    .optional()
    .describe("true (default): the message is about this project and shows under its filter. false for an organization-wide note."),
} as const;

export const sendWhatsappMessageTool = {
  name: "send_whatsapp_message",
  config: {
    title: "Send WhatsApp message",
    description:
      "Message the team on WhatsApp: a progress update, a plan for them to confirm, or a request to approve a recommendation (include its link — approval happens in the app, not over WhatsApp). This reaches real phones, so send one considered message rather than several; a routine should usually send at most one. Recorded in the app either way; if WhatsApp is not connected the message is kept with status not_sent. Uses no credits.",
    inputSchema: sendInputSchema,
    outputSchema: {
      sent: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof sendInputSchema>>, context) => {
      requireOrgPermission(context.auth, { member: ["update"] });
      const organizationId = context.auth.organizationId;
      const all = await WhatsappRepository.listRecipients(organizationId);
      const targets = args.recipientIds?.length
        ? all.filter((row) => args.recipientIds?.includes(row.id))
        : all.filter((row) => row.enabled);

      const sent = [];
      for (const recipient of targets) {
        const { id } = await WhatsappService.sendToRecipient({
          organizationId,
          recipientId: recipient.id,
          body: args.body,
          projectId: args.tagProject === false ? null : args.projectId,
          author: "agent",
          createdBy: context.auth.userId,
        });
        sent.push({ id, recipientId: recipient.id, recipientName: recipient.name });
      }

      return mcpResponse({
        text: sent.length
          ? `Sent to ${sent.map((row) => row.recipientName).join(", ")}. Check delivery with list_whatsapp_messages.`
          : "No recipients to send to. Add recipients on the WhatsApp page first.",
        meta: buildProjectMeta(context, args.projectId, whatsappPath(args.projectId)),
        structuredContent: { sent },
      });
    },
  ),
};
