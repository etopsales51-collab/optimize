import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

// Postgres mirror of ../publish.schema.ts. Structure must stay identical —
// same columns, nullability, enums, defaults, keys — or schema-parity.test.ts
// fails. See that file for what each column is for.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const timestampColumn = (name: string) => text(name);

export const projectPublishSettings = pgTable(
  "project_publish_settings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    wordpressBaseUrl: text("wordpress_base_url"),

    // See ../publish.schema.ts for why there are two credential pairs.
    wpUsername: text("wp_username"),
    wpAppPasswordSealed: text("wp_app_password_sealed"),
    wooConsumerKey: text("woo_consumer_key"),
    wooConsumerSecretSealed: text("woo_consumer_secret_sealed"),

    novamiraMode: text("novamira_mode", { enum: ["api", "mcp"] }),
    novamiraBaseUrl: text("novamira_base_url"),
    novamiraKeySealed: text("novamira_key_sealed"),

    pagesChannel: text("pages_channel", {
      enum: ["novamira", "wp_rest", "manual"],
    })
      .notNull()
      .default("manual"),
    productsChannel: text("products_channel", {
      enum: ["novamira", "wp_rest", "manual"],
    })
      .notNull()
      .default("wp_rest"),

    publishingEnabled: boolean("publishing_enabled").notNull().default(false),

    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("project_publish_settings_project_id_uidx").on(table.projectId),
  ],
);

export const wordpressPageDrafts = pgTable(
  "wordpress_page_drafts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    wpPageId: integer("wp_page_id"),
    schemaVersion: text("schema_version").notNull().default("optimize-page-v1"),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    documentJson: text("document_json").notNull(),
    remoteModifiedGmt: text("remote_modified_gmt"),
    previewUrl: text("preview_url"),
    status: text("status", { enum: ["draft", "publish"] })
      .notNull()
      .default("draft"),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("wordpress_page_drafts_project_slug_uidx").on(
      table.projectId,
      table.slug,
    ),
    uniqueIndex("wordpress_page_drafts_project_wp_page_uidx").on(
      table.projectId,
      table.wpPageId,
    ),
  ],
);
