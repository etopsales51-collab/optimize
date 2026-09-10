import type { OptimizeProposal } from "@/shared/optimize";

/**
 * WooCommerce REST adapter — the only code in this app that can change a live
 * store. Every decision here narrows what it is able to do.
 *
 * WHY WOOCOMMERCE AND NOT THE WORDPRESS API
 * Verified against wacomme.ae: /wp/v2/product exposes 26 meta keys but none of
 * Rank Math's, so the WordPress API physically cannot write the SEO fields a
 * recommendation changes. /wc/v3/products does expose them in meta_data. For
 * products, this is the only route that works.
 *
 * WHAT IT WRITES, AND WHAT IT MUST NEVER WRITE
 * Only two Rank Math meta fields:
 *
 *   proposal.title           -> rank_math_title        (the SEO title)
 *   proposal.metaDescription -> rank_math_description  (the meta description)
 *
 * NOT the product `name`. That distinction matters more than it looks: a
 * recommendation's "title" is a search-results title like
 * "Wacom STU-430 | Signature Pad UAE". Writing that to `name` would rename the
 * product everywhere a shopper sees it — catalogue, cart, invoices, schema.
 *
 * And never price, stock, status, categories or images. A WooCommerce key with
 * write access CAN change all of those, so the restriction cannot come from
 * the credential — WooCommerce only offers Read / Write / Read-Write, with no
 * field scoping. It has to come from this file, which is why the request body
 * is built from an allowlist and asserted in tests.
 */

export type WooCredentials = {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

export type ResolvedProduct = {
  id: number;
  name: string;
  permalink: string;
  currentSeoTitle: string;
  currentSeoDescription: string;
};

export type PlannedChange = {
  field: "rank_math_title" | "rank_math_description";
  label: string;
  before: string;
  after: string;
};

export type DryRunResult =
  | { ok: true; target: ResolvedProduct; changes: PlannedChange[] }
  | { ok: false; reason: string };

export type ApplyResult =
  | { ok: true; target: ResolvedProduct; applied: PlannedChange[]; revisionHint: string }
  | { ok: false; reason: string };

const REQUEST_TIMEOUT_MS = 20_000;

/** The only meta keys this adapter is permitted to write. */
const WRITABLE_META = ["rank_math_title", "rank_math_description"] as const;

type MetaRow = { key?: string; value?: unknown };

function authHeader(credentials: WooCredentials): string {
  const raw = `${credentials.consumerKey}:${credentials.consumerSecret}`;
  let binary = "";
  for (const byte of new TextEncoder().encode(raw)) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
}

async function wooFetch(
  credentials: WooCredentials,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = credentials.baseUrl.replace(/\/+$/, "");
  return fetch(`${base}/wp-json/wc/v3${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: authHeader(credentials),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** Readable reason, with the credential never echoed back. */
async function describeFailure(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    return `WooCommerce rejected the credentials (${response.status}). Check the consumer key and secret, and that the key has Read/Write permission.`;
  }
  if (response.status === 404) {
    return "WooCommerce returned 404 for the REST endpoint. Check the store URL.";
  }
  const body = await response.text().catch(() => "");
  return `WooCommerce returned ${response.status}. ${body.slice(0, 200)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readMeta(meta: MetaRow[] | undefined, key: string): string {
  const row = meta?.find((entry) => entry.key === key);
  return typeof row?.value === "string" ? row.value : "";
}

/** Resolve a public product URL to its WooCommerce product via its slug. */
export async function resolveProduct(
  credentials: WooCredentials,
  targetUrl: string,
): Promise<{ ok: true; target: ResolvedProduct } | { ok: false; reason: string }> {
  let slug: string;
  try {
    const segments = new URL(targetUrl).pathname.split("/").filter(Boolean);
    slug = segments[segments.length - 1] ?? "";
  } catch {
    return { ok: false, reason: `Not a valid URL: ${targetUrl}` };
  }
  if (!slug) {
    return { ok: false, reason: "That URL has no product slug to resolve." };
  }

  const response = await wooFetch(
    credentials,
    `/products?slug=${encodeURIComponent(slug)}&per_page=1`,
  );
  if (!response.ok) return { ok: false, reason: await describeFailure(response) };

  const rows = (await response.json().catch(() => [])) as Array<{
    id?: number;
    name?: string;
    permalink?: string;
    meta_data?: MetaRow[];
  }>;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row?.id) {
    return {
      ok: false,
      reason: `No published product matches the slug "${slug}". If this URL is a page or blog post, it is not a WooCommerce product and needs a different channel.`,
    };
  }

  return {
    ok: true,
    target: {
      id: row.id,
      name: row.name ?? "",
      permalink: row.permalink ?? targetUrl,
      currentSeoTitle: readMeta(row.meta_data, "rank_math_title"),
      currentSeoDescription: readMeta(row.meta_data, "rank_math_description"),
    },
  };
}

function planChanges(
  proposal: OptimizeProposal,
  target: ResolvedProduct,
): PlannedChange[] {
  const changes: PlannedChange[] = [];

  const nextTitle = proposal.title?.after?.trim();
  if (nextTitle && nextTitle !== target.currentSeoTitle.trim()) {
    changes.push({
      field: "rank_math_title",
      label: "SEO title",
      before: target.currentSeoTitle,
      after: nextTitle,
    });
  }

  const nextDescription = proposal.metaDescription?.after?.trim();
  if (nextDescription && nextDescription !== target.currentSeoDescription.trim()) {
    changes.push({
      field: "rank_math_description",
      label: "Meta description",
      before: target.currentSeoDescription,
      after: nextDescription,
    });
  }

  return changes;
}

/**
 * Create a product from a new_page_brief, as a DRAFT.
 *
 * Draft, not published, and that is the important decision. A brief carries
 * content — a name, an overview, specifications — but nothing commercial: no
 * price, no SKU, no images, no category, no stock. A product published with
 * those missing is worse for a store than no product at all: it can be
 * indexed, linked and found by a customer who then cannot buy it.
 *
 * So this writes everything the brief legitimately knows and stops. The person
 * adds price and images in WordPress and presses Publish, which is one click
 * and the only step that needs a human judgement anyway.
 *
 * The site's product layout is not copied because it does not need to be:
 * every product on this store renders from one shared Elementor template, so a
 * new product inherits it on publish.
 *
 * Field mapping is deliberate. `name` comes from the H1 — the product's real
 * name — never from the SEO title, which is a search-results headline and
 * would read as marketing copy in the catalogue and on invoices.
 */
export async function createDraftProduct(
  credentials: WooCredentials,
  targetUrl: string,
  proposal: OptimizeProposal,
): Promise<ApplyResult> {
  let slug: string;
  try {
    const segments = new URL(targetUrl).pathname.split("/").filter(Boolean);
    slug = segments[segments.length - 1] ?? "";
  } catch {
    return { ok: false, reason: `Not a valid URL: ${targetUrl}` };
  }
  if (!slug) {
    return { ok: false, reason: "That URL has no slug to create a product at." };
  }

  // Refuse if something already lives at this slug — creating a second would
  // produce the duplicate URLs the whole anti-cannibalization rule exists to
  // prevent.
  const existing = await resolveProduct(credentials, targetUrl);
  if (existing.ok) {
    return {
      ok: false,
      reason: `A product already exists at "${slug}" (id ${existing.target.id}). Change this recommendation to content_refresh so it improves that product instead of creating a duplicate.`,
    };
  }

  const name = proposal.h1?.after?.trim();
  if (!name) {
    return {
      ok: false,
      reason:
        "This brief has no H1, so there is no product name to create. Ask the agent to add one.",
    };
  }

  // The brief's sections become the product description, in order.
  const description = (proposal.sections ?? [])
    .filter((section) => section.action !== "remove" && section.after?.trim())
    .map((section) =>
      section.heading
        ? `<h2>${escapeHtml(section.heading)}</h2>\n${section.after}`
        : section.after,
    )
    .join("\n\n");

  const metaData = [
    proposal.title?.after?.trim()
      ? { key: "rank_math_title", value: proposal.title.after.trim() }
      : null,
    proposal.metaDescription?.after?.trim()
      ? {
          key: "rank_math_description",
          value: proposal.metaDescription.after.trim(),
        }
      : null,
  ].filter((row): row is { key: string; value: string } => row !== null);

  const response = await wooFetch(credentials, "/products", {
    method: "POST",
    body: JSON.stringify({
      name,
      slug,
      type: "simple",
      // The safety property of this whole function.
      status: "draft",
      description,
      meta_data: metaData,
    }),
  });

  if (!response.ok) return { ok: false, reason: await describeFailure(response) };

  const created = (await response.json().catch(() => ({}))) as {
    id?: number;
    name?: string;
    permalink?: string;
  };
  if (!created.id) {
    return { ok: false, reason: "WooCommerce did not return a product id." };
  }

  return {
    ok: true,
    target: {
      id: created.id,
      name: created.name ?? name,
      permalink: created.permalink ?? targetUrl,
      currentSeoTitle: "",
      currentSeoDescription: "",
    },
    applied: [
      { field: "rank_math_title", label: "SEO title", before: "", after: proposal.title?.after ?? "" },
      { field: "rank_math_description", label: "Meta description", before: "", after: proposal.metaDescription?.after ?? "" },
    ],
    revisionHint: `Created as DRAFT product ${created.id}. Add price, images, SKU and category in WordPress, then publish it.`,
  };
}

export async function dryRun(
  credentials: WooCredentials,
  targetUrl: string,
  proposal: OptimizeProposal,
): Promise<DryRunResult> {
  const resolved = await resolveProduct(credentials, targetUrl);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  const changes = planChanges(proposal, resolved.target);
  if (changes.length === 0) {
    return {
      ok: false,
      reason:
        "Nothing to publish: the SEO title and meta description already match this proposal. Section rewrites and body copy are applied by hand.",
    };
  }

  return { ok: true, target: resolved.target, changes };
}

export async function apply(
  credentials: WooCredentials,
  targetUrl: string,
  proposal: OptimizeProposal,
): Promise<ApplyResult> {
  // Re-resolve rather than trusting an earlier dry run: the product may have
  // changed since, and writing a stale plan would overwrite that edit.
  const planned = await dryRun(credentials, targetUrl, proposal);
  if (!planned.ok) return { ok: false, reason: planned.reason };

  // Allowlist, built field by field. Nothing else can enter this body — in
  // particular no name, price, stock_status, status, categories or images.
  const metaData = planned.changes
    .filter((change) => WRITABLE_META.includes(change.field))
    .map((change) => ({ key: change.field, value: change.after }));

  if (metaData.length === 0) {
    return { ok: false, reason: "No permitted field to write." };
  }

  const response = await wooFetch(credentials, `/products/${planned.target.id}`, {
    method: "PUT",
    body: JSON.stringify({ meta_data: metaData }),
  });

  if (!response.ok) return { ok: false, reason: await describeFailure(response) };

  return {
    ok: true,
    target: planned.target,
    applied: planned.changes,
    revisionHint: `product ${planned.target.id} (${planned.target.name}) — previous SEO values are recorded in this recommendation's job events.`,
  };
}
