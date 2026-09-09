import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";

// ============================================================================
// Publishing settings — how an approved recommendation reaches the live site
//
// One row per project. Credentials are stored SEALED (see server/lib/
// secret-box.ts) and are never selected into anything that leaves the server:
// not a server-function response, not an MCP tool result, not a log line. The
// UI only ever learns whether a credential is present and readable.
// ============================================================================

export const projectPublishSettings = sqliteTable(
  "project_publish_settings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    // e.g. https://wacomme.ae — the site root, no trailing slash.
    wordpressBaseUrl: text("wordpress_base_url"),

    // TWO credentials, because neither API can do the whole job. Verified
    // against wacomme.ae: /wp/v2/product exposes 26 meta keys and none of Rank
    // Math's, so product SEO fields are only writable through WooCommerce;
    // pages and posts are only reachable through the WordPress API.
    //
    // WordPress application password — pages, posts, media. Scoped by the
    // WordPress user's role, so a dedicated Editor account cannot reach
    // orders, customers or settings.
    wpUsername: text("wp_username"),
    wpAppPasswordSealed: text("wp_app_password_sealed"),

    // WooCommerce REST key — product SEO meta. Cannot be scoped by field;
    // WooCommerce offers only Read / Write, so the narrowing lives in
    // woocommerceAdapter.ts instead.
    wooConsumerKey: text("woo_consumer_key"),
    wooConsumerSecretSealed: text("woo_consumer_secret_sealed"),

    // NovaMira stays an interface until its API is known; these columns exist
    // so wiring it later is configuration rather than a migration.
    novamiraMode: text("novamira_mode", { enum: ["api", "mcp"] }),
    novamiraBaseUrl: text("novamira_base_url"),
    novamiraKeySealed: text("novamira_key_sealed"),

    // Which channel handles which kind of URL. Products default to WP REST
    // because WooCommerce is the system of record for them.
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

    // Safety switch. Off means every approval stops at "approved" and nothing
    // is written to WordPress, whatever else is configured.
    publishingEnabled: integer("publishing_enabled", { mode: "boolean" })
      .notNull()
      .default(false),

    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("project_publish_settings_project_id_uidx").on(table.projectId),
  ],
);
