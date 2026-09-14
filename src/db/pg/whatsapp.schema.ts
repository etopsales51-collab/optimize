import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

// Postgres mirror of ../whatsapp.schema.ts. Structure must stay identical or
// schema-parity.test.ts fails. See that file for what each column is for.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const whatsappRecipients = pgTable(
  "whatsapp_recipients",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastInboundAt: text("last_inbound_at"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("whatsapp_recipients_org_phone_uidx").on(
      table.organizationId,
      table.phone,
    ),
  ],
);

export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    recipientId: text("recipient_id").references(() => whatsappRecipients.id, {
      onDelete: "set null",
    }),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    kind: text("kind", { enum: ["alert", "message"] })
      .notNull()
      .default("message"),
    alertType: text("alert_type", {
      enum: [
        "keyword_drop",
        "audit_warning",
        "approval_needed",
        "published",
        "publish_failed",
        "progress",
      ],
    }),
    author: text("author", { enum: ["system", "user", "agent", "recipient"] })
      .notNull()
      .default("system"),
    fromNumber: text("from_number").notNull(),
    toNumber: text("to_number").notNull(),
    body: text("body").notNull(),
    mediaUrl: text("media_url"),
    messageSid: text("message_sid"),
    status: text("status"),
    error: text("error"),
    dedupeKey: text("dedupe_key"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("whatsapp_messages_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("whatsapp_messages_recipient_created_idx").on(
      table.recipientId,
      table.createdAt,
    ),
    index("whatsapp_messages_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("whatsapp_messages_sid_idx").on(table.messageSid),
    index("whatsapp_messages_dedupe_idx").on(
      table.organizationId,
      table.dedupeKey,
    ),
  ],
);
