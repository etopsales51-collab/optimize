import { AppError } from "@/server/lib/errors";
import { ProjectService } from "@/server/features/projects/services/ProjectService";
import {
  WhatsappRepository,
  type WhatsappMessageRow,
  type WhatsappRecipientRow,
} from "./WhatsappRepository";
import { readTwilioConfig, sendWhatsapp, REQUIRED_SECRETS } from "./twilio";
import {
  chooseSendMode,
  clipBody,
  normalizePhone,
  phonesMatch,
} from "./whatsappRules";

/**
 * The team channel: one conversation per person, shared by every project.
 *
 * Sending never throws for an operational reason — a missing secret, a Twilio
 * rejection — because the callers are rank checks, audits and publishes that
 * must not fail over a notification. The outcome is recorded on the message,
 * where the page shows it. Only a caller mistake (unknown recipient, empty
 * text) is an error.
 */

export type WhatsappAlertType = NonNullable<WhatsappMessageRow["alertType"]>;
export type WhatsappAuthor = WhatsappMessageRow["author"];

export type ConnectionStatus = {
  connected: boolean;
  missing: string[];
  templateConfigured: boolean;
  inboundTokenConfigured: boolean;
  /** Where Twilio's "When a message comes in" webhook must point. */
  webhookPath: string;
};

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const read = await readTwilioConfig();
  return {
    connected: read.ok,
    missing: read.ok ? [] : read.missing,
    templateConfigured: read.ok && Boolean(read.config.templateSid),
    inboundTokenConfigured: read.ok && Boolean(read.config.inboundToken),
    webhookPath: "/api/whatsapp/inbound?token=<WHATSAPP_INBOUND_TOKEN>",
  };
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

export function recipientView(row: WhatsappRecipientRow) {
  return {
    id: row.id,
    name: row.name,
    phone: `+${row.phone}`,
    enabled: row.enabled,
    lastInboundAt: row.lastInboundAt,
  };
}

export async function addRecipient(input: {
  organizationId: string;
  name: string;
  phone: string;
}) {
  const phone = normalizePhone(input.phone);
  if (!phone) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Enter the WhatsApp number with its country code, e.g. +971 50 123 4567.",
    );
  }
  const existing = await WhatsappRepository.listRecipients(input.organizationId);
  if (existing.some((row) => phonesMatch(row.phone, phone))) {
    throw new AppError("CONFLICT", "That number is already a recipient.");
  }
  return WhatsappRepository.insertRecipient({
    organizationId: input.organizationId,
    name: input.name.trim(),
    phone,
  });
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

type SendInput = {
  organizationId: string;
  recipient: WhatsappRecipientRow;
  body: string;
  projectId?: string | null;
  kind: "alert" | "message";
  alertType?: WhatsappAlertType | null;
  author: WhatsappAuthor;
  createdBy?: string | null;
  dedupeKey?: string | null;
};

async function sendOne(input: SendInput): Promise<string> {
  const body = clipBody(input.body);
  const read = await readTwilioConfig();

  const base = {
    organizationId: input.organizationId,
    projectId: input.projectId ?? null,
    recipientId: input.recipient.id,
    direction: "out" as const,
    kind: input.kind,
    alertType: input.alertType ?? null,
    author: input.author,
    toNumber: input.recipient.phone,
    body,
    createdBy: input.createdBy ?? null,
    dedupeKey: input.dedupeKey ?? null,
  };

  if (!read.ok) {
    // Kept, so the page shows what would have gone out once connected.
    return WhatsappRepository.insertMessage({
      ...base,
      fromNumber: "",
      status: "not_sent",
      error: `WhatsApp isn't connected yet. Add ${read.missing.join(", ")} on Railway.`,
    });
  }

  const result = await sendWhatsapp(read.config, {
    to: input.recipient.phone,
    body,
    mode: chooseSendMode(input.recipient.lastInboundAt, read.config.templateSid),
  });

  return WhatsappRepository.insertMessage({
    ...base,
    fromNumber: read.config.from,
    messageSid: result.ok ? result.sid : null,
    status: result.ok ? result.status : "failed",
    error: result.ok ? null : result.error,
  });
}

/** A person, or an agent acting for one, writing to a single recipient. */
export async function sendToRecipient(input: {
  organizationId: string;
  recipientId: string;
  body: string;
  projectId?: string | null;
  author: "user" | "agent";
  createdBy?: string | null;
}) {
  const recipient = await WhatsappRepository.getRecipient(
    input.organizationId,
    input.recipientId,
  );
  if (!recipient) throw new AppError("NOT_FOUND", "Recipient not found.");
  if (!input.body.trim()) {
    throw new AppError("VALIDATION_ERROR", "Write a message first.");
  }
  const id = await sendOne({
    organizationId: input.organizationId,
    recipient,
    body: input.body,
    projectId: input.projectId,
    kind: "message",
    author: input.author,
    createdBy: input.createdBy,
  });
  return { id };
}

/**
 * Tell the whole team about something. One message per enabled recipient, and
 * never twice for the same event: a dedupe key already on record means this
 * event was announced, so a retried workflow or re-run stays silent.
 */
export async function notifyTeam(input: {
  organizationId: string;
  projectId?: string | null;
  alertType: WhatsappAlertType;
  body: string;
  dedupeKey: string;
  author?: "system" | "agent";
}): Promise<{ sent: number; skipped: "duplicate" | "no_recipients" | null }> {
  if (await WhatsappRepository.hasDedupeKey(input.organizationId, input.dedupeKey)) {
    return { sent: 0, skipped: "duplicate" };
  }
  const recipients = (
    await WhatsappRepository.listRecipients(input.organizationId)
  ).filter((row) => row.enabled);
  if (recipients.length === 0) return { sent: 0, skipped: "no_recipients" };

  for (const recipient of recipients) {
    await sendOne({
      organizationId: input.organizationId,
      recipient,
      body: input.body,
      projectId: input.projectId,
      kind: "alert",
      alertType: input.alertType,
      author: input.author ?? "system",
      dedupeKey: input.dedupeKey,
    });
  }
  return { sent: recipients.length, skipped: null };
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

/**
 * Record a message a team member sent to the WhatsApp number. Matched to every
 * organization that has that person as a recipient; a number nobody added is
 * dropped, since this channel is not open to the public.
 */
export async function recordInbound(input: {
  from: string;
  to: string;
  body: string;
  mediaUrl: string | null;
  messageSid: string | null;
}): Promise<{ matched: number }> {
  const from = normalizePhone(input.from);
  if (!from) return { matched: 0 };

  const recipients = (await WhatsappRepository.listAllRecipients()).filter(
    (row) => phonesMatch(row.phone, from),
  );
  const receivedAt = new Date().toISOString();

  for (const recipient of recipients) {
    await WhatsappRepository.insertMessage({
      organizationId: recipient.organizationId,
      recipientId: recipient.id,
      projectId: null,
      direction: "in",
      kind: "message",
      author: "recipient",
      fromNumber: from,
      toNumber: normalizePhone(input.to) ?? "",
      body: input.body,
      mediaUrl: input.mediaUrl,
      messageSid: input.messageSid,
      status: "received",
    });
    // Reopens WhatsApp's 24-hour window for free-form replies to this person.
    await WhatsappRepository.updateRecipient(
      recipient.organizationId,
      recipient.id,
      { lastInboundAt: receivedAt },
    );
  }
  return { matched: recipients.length };
}

export async function recordDeliveryStatus(input: {
  messageSid: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
}) {
  const error =
    input.errorCode || input.errorMessage
      ? [input.errorCode, input.errorMessage].filter(Boolean).join(": ")
      : null;
  await WhatsappRepository.updateStatusBySid(input.messageSid, {
    status: input.status,
    error,
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listConversations(input: {
  organizationId: string;
  projectId?: string | null;
}) {
  const recipients = await WhatsappRepository.listRecipients(input.organizationId);
  const rows = await Promise.all(
    recipients.map(async (recipient) => ({
      recipient: recipientView(recipient),
      latest: await WhatsappRepository.latestMessage({
        organizationId: input.organizationId,
        recipientId: recipient.id,
        projectId: input.projectId,
      }),
    })),
  );
  // Most recent conversation first; people with no messages yet at the end.
  return rows.sort((a, b) =>
    (b.latest?.createdAt ?? "").localeCompare(a.latest?.createdAt ?? ""),
  );
}

export async function listThread(input: {
  organizationId: string;
  recipientId: string;
  projectId?: string | null;
}) {
  const rows = await WhatsappRepository.listThread({ ...input, limit: 200 });
  return rows.map(({ message, projectName }) => ({ ...message, projectName }));
}

export async function listRecentForAgent(input: {
  organizationId: string;
  projectId?: string | null;
  since?: string | null;
  limit: number;
}) {
  const rows = await WhatsappRepository.listRecent(input);
  return rows.map(({ message, recipientName, projectName }) => ({
    id: message.id,
    createdAt: message.createdAt,
    direction: message.direction,
    author: message.author,
    kind: message.kind,
    alertType: message.alertType,
    recipientId: message.recipientId,
    recipientName,
    projectId: message.projectId,
    projectName,
    body: message.body,
    status: message.status,
    error: message.error,
  }));
}

/** Resolve a project's organization and display name for an alert. */
export async function projectForAlert(projectId: string) {
  const resolved = await ProjectService.getProjectWithOrganization(projectId);
  return resolved
    ? {
        organizationId: resolved.organizationId,
        name: resolved.project.name,
      }
    : null;
}

export const WhatsappService = {
  getConnectionStatus,
  addRecipient,
  sendToRecipient,
  notifyTeam,
  recordInbound,
  recordDeliveryStatus,
  listConversations,
  listThread,
  listRecentForAgent,
  projectForAlert,
  requiredSecrets: REQUIRED_SECRETS,
} as const;
