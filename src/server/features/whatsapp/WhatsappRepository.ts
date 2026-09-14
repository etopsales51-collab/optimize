import { and, asc, desc, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { projects, whatsappMessages, whatsappRecipients } from "@/db/schema";

// Storage for the WhatsApp channel. Recipient lists are a handful of people per
// organization, so lookups that span recipients load them and decide in code
// rather than pushing phone-number matching into SQL.

export type WhatsappRecipientRow = typeof whatsappRecipients.$inferSelect;
export type WhatsappMessageRow = typeof whatsappMessages.$inferSelect;
export type NewWhatsappMessage = typeof whatsappMessages.$inferInsert;

const nowIso = () => new Date().toISOString();

async function listRecipients(organizationId: string) {
  return db
    .select()
    .from(whatsappRecipients)
    .where(eq(whatsappRecipients.organizationId, organizationId))
    .orderBy(asc(whatsappRecipients.name));
}

/** Every recipient in every organization — inbound messages arrive unaddressed. */
async function listAllRecipients() {
  return db.select().from(whatsappRecipients);
}

async function getRecipient(organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(whatsappRecipients)
    .where(
      and(
        eq(whatsappRecipients.id, id),
        eq(whatsappRecipients.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function insertRecipient(input: {
  organizationId: string;
  name: string;
  phone: string;
}) {
  const id = crypto.randomUUID();
  const stamp = nowIso();
  await db.insert(whatsappRecipients).values({
    id,
    organizationId: input.organizationId,
    name: input.name,
    phone: input.phone,
    enabled: true,
    createdAt: stamp,
    updatedAt: stamp,
  });
  return id;
}

async function updateRecipient(
  organizationId: string,
  id: string,
  patch: Partial<Pick<WhatsappRecipientRow, "name" | "enabled" | "lastInboundAt">>,
) {
  await db
    .update(whatsappRecipients)
    .set({ ...patch, updatedAt: nowIso() })
    .where(
      and(
        eq(whatsappRecipients.id, id),
        eq(whatsappRecipients.organizationId, organizationId),
      ),
    );
}

async function deleteRecipient(organizationId: string, id: string) {
  await db
    .delete(whatsappRecipients)
    .where(
      and(
        eq(whatsappRecipients.id, id),
        eq(whatsappRecipients.organizationId, organizationId),
      ),
    );
}

async function insertMessage(row: Omit<NewWhatsappMessage, "id" | "createdAt">) {
  const id = crypto.randomUUID();
  await db
    .insert(whatsappMessages)
    .values({ ...row, id, createdAt: nowIso() });
  return id;
}

async function hasDedupeKey(organizationId: string, dedupeKey: string) {
  const [row] = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.organizationId, organizationId),
        eq(whatsappMessages.dedupeKey, dedupeKey),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function updateStatusBySid(
  messageSid: string,
  patch: { status: string; error: string | null },
) {
  await db
    .update(whatsappMessages)
    .set(patch)
    .where(eq(whatsappMessages.messageSid, messageSid));
}

/**
 * A recipient's thread, oldest first. With a project filter, alerts about
 * other projects are hidden but untagged messages (replies, general notes)
 * stay, since a reply belongs to the conversation, not to one project.
 */
async function listThread(input: {
  organizationId: string;
  recipientId: string;
  projectId?: string | null;
  limit: number;
}) {
  const rows = await db
    .select({
      message: whatsappMessages,
      projectName: projects.name,
    })
    .from(whatsappMessages)
    .leftJoin(projects, eq(projects.id, whatsappMessages.projectId))
    .where(
      and(
        eq(whatsappMessages.organizationId, input.organizationId),
        eq(whatsappMessages.recipientId, input.recipientId),
        input.projectId
          ? or(
              eq(whatsappMessages.projectId, input.projectId),
              isNull(whatsappMessages.projectId),
            )
          : undefined,
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(input.limit);
  return rows.reverse();
}

async function latestMessage(input: {
  organizationId: string;
  recipientId: string;
  projectId?: string | null;
}) {
  const [row] = await listThread({ ...input, limit: 1 });
  return row?.message ?? null;
}

/** Recent messages across the organization, newest first, for agents. */
async function listRecent(input: {
  organizationId: string;
  projectId?: string | null;
  since?: string | null;
  limit: number;
}) {
  return db
    .select({
      message: whatsappMessages,
      recipientName: whatsappRecipients.name,
      projectName: projects.name,
    })
    .from(whatsappMessages)
    .leftJoin(
      whatsappRecipients,
      eq(whatsappRecipients.id, whatsappMessages.recipientId),
    )
    .leftJoin(projects, eq(projects.id, whatsappMessages.projectId))
    .where(
      and(
        eq(whatsappMessages.organizationId, input.organizationId),
        input.projectId
          ? eq(whatsappMessages.projectId, input.projectId)
          : undefined,
        input.since ? gte(whatsappMessages.createdAt, input.since) : undefined,
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(input.limit);
}

export const WhatsappRepository = {
  listRecipients,
  listAllRecipients,
  getRecipient,
  insertRecipient,
  updateRecipient,
  deleteRecipient,
  insertMessage,
  hasDedupeKey,
  updateStatusBySid,
  listThread,
  latestMessage,
  listRecent,
} as const;
