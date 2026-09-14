import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

// ============================================================================
// WhatsApp — the team's alert and approval channel
//
// Not a customer inbox. The app pushes SEO alerts (keyword drops, audit
// warnings, work waiting for approval, publish results) to the people who run
// the sites; they reply, and an agent reads the thread over MCP to plan and
// propose work. One channel per organization: every project's alerts go to the
// same recipients, each message tagged with the project it is about.
//
// Timestamps the app compares (created_at ordering, last_inbound_at for
// WhatsApp's 24-hour window) are written by the app as ISO strings, so both
// dialects sort and parse them identically.
// ============================================================================

export const whatsappRecipients = sqliteTable(
  "whatsapp_recipients",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Digits only, country code first, no "+": 971501234567.
    phone: text("phone").notNull(),
    // Off keeps the person and their history but sends them nothing.
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    // WhatsApp only allows free-form business messages within 24 hours of the
    // person's last message; outside it a pre-approved template is required.
    lastInboundAt: text("last_inbound_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("whatsapp_recipients_org_phone_uidx").on(
      table.organizationId,
      table.phone,
    ),
  ],
);

export const whatsappMessages = sqliteTable(
  "whatsapp_messages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The project an alert is about. Null for a general message or a reply.
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    recipientId: text("recipient_id").references(() => whatsappRecipients.id, {
      onDelete: "set null",
    }),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    // alert = raised by the app; message = typed by a person or an agent.
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
    // Twilio's delivery status (queued, sent, delivered, read, failed,
    // undelivered) or "received" for inbound.
    status: text("status"),
    error: text("error"),
    // Identifies the event an alert was raised for, so the same event never
    // sends twice — keeps the channel quiet under retries and re-runs.
    dedupeKey: text("dedupe_key"),
    createdBy: text("created_by"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
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
