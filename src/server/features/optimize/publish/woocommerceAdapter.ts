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
 * CREATE OR UPDATE IS DECIDED BY THE STORE, NOT BY THE RECOMMENDATION
 * A recommendation says what it wants; only the store knows what is already
 * there. So every publish resolves the target URL first and then either updates
 * that product or creates one. This is why re-publishing a brief after revising
 * it works: the first publish created the product, the second finds it and
 * updates it. A recommendation's `type` no longer decides the verb — it only
 * decides whether creating is PERMITTED, because only a new_page_brief carries
 * the anti-cannibalization check that makes a brand new URL safe.
 *
 * WHAT IT WRITES, AND WHAT IT MUST NEVER WRITE
 * On an existing product, four things and no more:
 *
 *   proposal.title           -> rank_math_title        (the SEO title)
 *   proposal.metaDescription -> rank_math_description  (the meta description)
 *   status: draft -> publish, and only in that direction
 *   categories, and only when the product has none but Uncategorized
 *
 * NOT the product `name`. That distinction matters more than it looks: a
 * recommendation's "title" is a search-results title like
 * "Wacom STU-430 | Signature Pad UAE". Writing that to `name` would rename the
 * product everywhere a shopper sees it — catalogue, cart, invoices, schema.
 *
 * And never price, stock, SKU or images. A WooCommerce key with write access
 * CAN change all of those, so the restriction cannot come from the credential —
 * WooCommerce only offers Read / Write / Read-Write, with no field scoping. It
 * has to come from this file, which is why every request body is built from an
 * allowlist and asserted in tests.
 */

export type WooCredentials = {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

export type ProductCategory = {
  id: number;
  name: string;
  slug: string;
  count: number;
};

export type ResolvedProduct = {
  id: number;
  name: string;
  permalink: string;
  /** "publish" | "draft" | "pending" | "private", as WooCommerce reports it. */
  status: string;
  categories: ProductCategory[];
  currentSeoTitle: string;
  currentSeoDescription: string;
};

export type PlannedField =
  | "rank_math_title"
  | "rank_math_description"
  | "name"
  | "description"
  | "status"
  | "categories";

export type PlannedChange = {
  field: PlannedField;
  label: string;
  before: string;
  after: string;
};

/** Whether this publish will edit an existing product or create one. */
export type PublishMode = "create" | "update";

export type PublishPlan =
  | {
      ok: true;
      mode: PublishMode;
      slug: string;
      /** null in create mode — nothing exists yet. */
      productId: number | null;
      productName: string;
      changes: PlannedChange[];
    }
  | { ok: false; reason: string };

export type ApplyResult =
  | {
      ok: true;
      mode: PublishMode;
      target: ResolvedProduct;
      applied: PlannedChange[];
      revisionHint: string;
    }
  | { ok: false; reason: string };

export type PublishOptions = {
  /**
   * Only a new_page_brief may bring a URL into existence, because only a brief
   * carries the cannibalization check. Everything else must find its target.
   */
  allowCreate: boolean;
};

const REQUEST_TIMEOUT_MS = 20_000;

/** The only meta keys this adapter is permitted to write. */
const WRITABLE_META = ["rank_math_title", "rank_math_description"] as const;
type WritableMetaKey = (typeof WRITABLE_META)[number];

/**
 * A product sitting in these is treated as having no category at all, so the
 * brand category can be filled in. Anything else a human chose is left alone.
 */
const PLACEHOLDER_CATEGORY_SLUGS = new Set(["uncategorized", "uncategorised"]);

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

function slugFromUrl(targetUrl: string): string | null {
  try {
    const segments = new URL(targetUrl).pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "";
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Brand categories
//
// A product left in "Uncategorized" is missing from the store's own navigation
// and tells Google nothing. The brand is what these catalogues organise by —
// ubio.ae already has "Nitgen Biometric Devices" holding nine products — so
// that is what a new product joins.
// ---------------------------------------------------------------------------

/** Comparison key: case, spacing and punctuation are all noise here. */
function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function wordsOf(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Words that can lead a product name without being the brand. */
const NOT_A_BRAND = new Set([
  "the",
  "new",
  "buy",
  "best",
  "genuine",
  "original",
  "product",
]);

/**
 * Work out which brand a product belongs to.
 *
 * An agent that knows the brand should say so — `proposal.brand` always wins.
 * Otherwise it is read off the front of the product name, which is how these
 * catalogues are written: "ViRDi AC-5000 IK", "Nitgen eNBioAccess-T9".
 *
 * The hyphen rule is the one worth stating: in "UBio-X Face Pro" the hyphen
 * starts the model, not the brand, so the brand is "UBio" and not "UBio-X". It
 * only applies when what precedes the hyphen is long enough to be a name, so
 * "AC-5000" is never reduced to "AC".
 */
export function inferBrand(
  proposal: Pick<OptimizeProposal, "brand">,
  productName: string,
): string | null {
  const declared = proposal.brand?.trim();
  if (declared) return declared;

  const firstWord = productName.trim().split(/\s+/)[0] ?? "";
  const beforeHyphen = firstWord.split(/[-–—/]/)[0] ?? "";
  const candidate = (
    beforeHyphen.length >= 3 ? beforeHyphen : firstWord
  ).replace(/[^\p{L}\p{N}&+]/gu, "");

  if (candidate.length < 3) return null;
  // A leading model number is not a brand.
  if (!/\p{L}/u.test(candidate)) return null;
  if (NOT_A_BRAND.has(candidate.toLowerCase())) return null;
  return candidate;
}

/**
 * Pick the existing category that represents this brand.
 *
 * Exact match first. Failing that, a category whose name CONTAINS the brand as
 * a whole word — the real case being "Nitgen", which is not a category on
 * ubio.ae but appears inside two of them. Where several contain it, the one
 * holding the most products wins, so a new Nitgen product lands beside the nine
 * already there rather than in an empty sibling.
 */
export function matchBrandCategory(
  categories: ProductCategory[],
  brand: string,
): ProductCategory | null {
  const wanted = normalizeName(brand);
  if (!wanted) return null;

  const exact = categories.find(
    (category) =>
      normalizeName(category.name) === wanted ||
      normalizeName(category.slug) === wanted,
  );
  if (exact) return exact;

  const brandWord = brand.toLowerCase();
  const containing = categories.filter((category) =>
    wordsOf(category.name).includes(brandWord),
  );
  if (containing.length === 0) return null;

  // Deterministic: most products, then the least qualified name, then oldest.
  return [...containing].sort(
    (a, b) => b.count - a.count || a.name.length - b.name.length || a.id - b.id,
  )[0];
}

function parseCategories(rows: unknown): ProductCategory[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const entry = row as {
      id?: number;
      name?: string;
      slug?: string;
      count?: number;
    };
    return typeof entry.id === "number"
      ? [
          {
            id: entry.id,
            name: entry.name ?? "",
            slug: entry.slug ?? "",
            count: typeof entry.count === "number" ? entry.count : 0,
          },
        ]
      : [];
  });
}

/** Read-only: find the brand's category if the store already has one. */
export async function findBrandCategory(
  credentials: WooCredentials,
  brand: string,
): Promise<ProductCategory | null> {
  const response = await wooFetch(
    credentials,
    `/products/categories?search=${encodeURIComponent(brand)}&per_page=100&hide_empty=false`,
  );
  if (!response.ok) return null;
  return matchBrandCategory(
    parseCategories(await response.json().catch(() => [])),
    brand,
  );
}

/** Find it, or create it — the "if it does not exist, create it" half. */
export async function ensureBrandCategory(
  credentials: WooCredentials,
  brand: string,
): Promise<
  { ok: true; category: ProductCategory } | { ok: false; reason: string }
> {
  const existing = await findBrandCategory(credentials, brand);
  if (existing) return { ok: true, category: existing };

  const response = await wooFetch(credentials, "/products/categories", {
    method: "POST",
    body: JSON.stringify({ name: brand }),
  });

  if (response.ok) {
    const created = parseCategories([
      await response.json().catch(() => ({})),
    ])[0];
    return created
      ? { ok: true, category: created }
      : { ok: false, reason: "WooCommerce did not return the new category." };
  }

  // Another publish may have created it a moment ago; WooCommerce hands back
  // the id of the term that already exists, which is the answer we wanted.
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    data?: { resource_id?: number };
  };
  if (body.code === "term_exists" && typeof body.data?.resource_id === "number") {
    return {
      ok: true,
      category: { id: body.data.resource_id, name: brand, slug: "", count: 0 },
    };
  }

  return { ok: false, reason: await describeFailure(response) };
}

function needsBrandCategory(target: ResolvedProduct): boolean {
  return target.categories.every((category) =>
    PLACEHOLDER_CATEGORY_SLUGS.has(category.slug.toLowerCase()),
  );
}

// ---------------------------------------------------------------------------
// Resolving and planning
// ---------------------------------------------------------------------------

/**
 * Resolve a public product URL to its WooCommerce product via its slug.
 *
 * Drafts count, and that is deliberate: a product this app created and left as
 * a draft must be found on the next publish, not mistaken for a free slug and
 * duplicated.
 */
export async function resolveProduct(
  credentials: WooCredentials,
  targetUrl: string,
): Promise<{ ok: true; target: ResolvedProduct } | { ok: false; reason: string }> {
  const slug = slugFromUrl(targetUrl);
  if (slug === null) return { ok: false, reason: `Not a valid URL: ${targetUrl}` };
  if (!slug) {
    return { ok: false, reason: "That URL has no product slug to resolve." };
  }

  const response = await wooFetch(
    credentials,
    `/products?slug=${encodeURIComponent(slug)}&per_page=1&status=any`,
  );
  if (!response.ok) return { ok: false, reason: await describeFailure(response) };

  const rows = (await response.json().catch(() => [])) as Array<{
    id?: number;
    name?: string;
    permalink?: string;
    status?: string;
    categories?: unknown;
    meta_data?: MetaRow[];
  }>;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row?.id) {
    return {
      ok: false,
      reason: `No product matches the slug "${slug}". If this URL is a page or blog post, it is not a WooCommerce product and needs a different channel.`,
    };
  }

  return {
    ok: true,
    target: {
      id: row.id,
      name: row.name ?? "",
      permalink: row.permalink ?? targetUrl,
      status: row.status ?? "publish",
      categories: parseCategories(row.categories),
      currentSeoTitle: readMeta(row.meta_data, "rank_math_title"),
      currentSeoDescription: readMeta(row.meta_data, "rank_math_description"),
    },
  };
}

function planMetaChanges(
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

/** Does this proposal carry anything writable at all? */
function hasSeoContent(proposal: OptimizeProposal): boolean {
  return Boolean(
    proposal.title?.after?.trim() || proposal.metaDescription?.after?.trim(),
  );
}

function buildDescription(proposal: OptimizeProposal): string {
  return (proposal.sections ?? [])
    .filter((section) => section.action !== "remove" && section.after?.trim())
    .map((section) =>
      section.heading
        ? `<h2>${escapeHtml(section.heading)}</h2>\n${section.after}`
        : section.after,
    )
    .join("\n\n");
}

/**
 * What publishing would do. Reads only — safe to call at any time, including
 * from the preview button, and it never creates a category.
 */
export async function plan(
  credentials: WooCredentials,
  targetUrl: string,
  proposal: OptimizeProposal,
  options: PublishOptions,
): Promise<PublishPlan> {
  const slug = slugFromUrl(targetUrl);
  if (slug === null) return { ok: false, reason: `Not a valid URL: ${targetUrl}` };
  if (!slug) return { ok: false, reason: "That URL has no product slug." };

  const existing = await resolveProduct(credentials, targetUrl);

  // ---- Update ------------------------------------------------------------
  if (existing.ok) {
    const target = existing.target;
    const changes = planMetaChanges(proposal, target);

    if (target.status === "draft") {
      changes.push({
        field: "status",
        label: "Product status",
        before: "draft",
        after: "publish",
      });
    }

    if (needsBrandCategory(target)) {
      const brand = inferBrand(proposal, target.name);
      if (brand) {
        const category = await findBrandCategory(credentials, brand);
        changes.push({
          field: "categories",
          label: "Category",
          before: target.categories.map((row) => row.name).join(", ") || "(none)",
          after: category ? category.name : `${brand} (will be created)`,
        });
      }
    }

    if (changes.length === 0 && !hasSeoContent(proposal)) {
      return {
        ok: false,
        reason:
          "This recommendation has no SEO title or meta description to write. Ask the agent to add one.",
      };
    }

    return {
      ok: true,
      mode: "update",
      slug,
      productId: target.id,
      productName: target.name,
      changes,
    };
  }

  // ---- Create ------------------------------------------------------------
  if (!options.allowCreate) {
    return {
      ok: false,
      reason: `Nothing exists at "${slug}" to update. If this URL should be created, ask the agent to send it as a new page brief — that is the type that carries the cannibalization check.`,
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

  const changes: PlannedChange[] = [
    {
      field: "name",
      label: "Product name",
      before: "(does not exist)",
      after: name,
    },
  ];

  const seoTitle = proposal.title?.after?.trim();
  if (seoTitle) {
    changes.push({
      field: "rank_math_title",
      label: "SEO title",
      before: "",
      after: seoTitle,
    });
  }

  const seoDescription = proposal.metaDescription?.after?.trim();
  if (seoDescription) {
    changes.push({
      field: "rank_math_description",
      label: "Meta description",
      before: "",
      after: seoDescription,
    });
  }

  if (buildDescription(proposal)) {
    const sectionCount = (proposal.sections ?? []).length;
    changes.push({
      field: "description",
      label: "Body content",
      before: "",
      after: `${sectionCount} section${sectionCount === 1 ? "" : "s"}`,
    });
  }

  const brand = inferBrand(proposal, name);
  if (brand) {
    const category = await findBrandCategory(credentials, brand);
    changes.push({
      field: "categories",
      label: "Category",
      before: "(none)",
      after: category ? category.name : `${brand} (will be created)`,
    });
  }

  return {
    ok: true,
    mode: "create",
    slug,
    productId: null,
    productName: name,
    changes,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Create the product a brief describes, published.
 *
 * Published rather than draft, at the operator's instruction: Approve already
 * is the review, so a second manual publish inside WordPress reviewed nothing
 * and only left products stranded as drafts. The trade-off is taken knowingly —
 * the product goes live before anyone has added a price, SKU or images.
 *
 * The site's product layout is not copied because it does not need to be: every
 * product on these stores renders from one shared Elementor template, so a new
 * product inherits it.
 *
 * Field mapping is deliberate. `name` comes from the H1 — the product's real
 * name — never from the SEO title, which is a search-results headline and would
 * read as marketing copy in the catalogue and on invoices.
 */
async function createProduct(
  credentials: WooCredentials,
  slug: string,
  targetUrl: string,
  proposal: OptimizeProposal,
): Promise<ApplyResult> {
  const name = proposal.h1?.after?.trim();
  if (!name) {
    return {
      ok: false,
      reason:
        "This brief has no H1, so there is no product name to create. Ask the agent to add one.",
    };
  }

  const metaData = WRITABLE_META.flatMap((key) => {
    const value =
      key === "rank_math_title"
        ? proposal.title?.after?.trim()
        : proposal.metaDescription?.after?.trim();
    return value ? [{ key, value }] : [];
  });

  const brand = inferBrand(proposal, name);
  const category = brand ? await ensureBrandCategory(credentials, brand) : null;
  // A category that cannot be created is not worth failing a publish over; it
  // is reported instead, and the next publish will try again.
  const categoryNote =
    category && !category.ok
      ? ` The brand category could not be set: ${category.reason}`
      : "";

  const response = await wooFetch(credentials, "/products", {
    method: "POST",
    body: JSON.stringify({
      name,
      slug,
      type: "simple",
      status: "publish",
      description: buildDescription(proposal),
      meta_data: metaData,
      ...(category?.ok ? { categories: [{ id: category.category.id }] } : {}),
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

  const applied: PlannedChange[] = [
    {
      field: "name",
      label: "Product name",
      before: "(did not exist)",
      after: name,
    },
    ...metaData.map((row) => ({
      field: row.key as PlannedField,
      label: row.key === "rank_math_title" ? "SEO title" : "Meta description",
      before: "",
      after: row.value,
    })),
  ];
  if (category?.ok) {
    applied.push({
      field: "categories",
      label: "Category",
      before: "(none)",
      after: category.category.name,
    });
  }

  return {
    ok: true,
    mode: "create",
    target: {
      id: created.id,
      name: created.name ?? name,
      permalink: created.permalink ?? targetUrl,
      status: "publish",
      categories: category?.ok ? [category.category] : [],
      currentSeoTitle: "",
      currentSeoDescription: "",
    },
    applied,
    revisionHint: `Created and published product ${created.id}. Add price, SKU and images in WordPress.${categoryNote}`,
  };
}

/** Update an existing product from a freshly planned diff. */
async function updateProduct(
  credentials: WooCredentials,
  target: ResolvedProduct,
  changes: PlannedChange[],
  proposal: OptimizeProposal,
): Promise<ApplyResult> {
  // Allowlist, built field by field. Nothing else can enter this body — in
  // particular no name, price, stock_status, sku or images.
  const metaData = changes
    .filter((change) =>
      WRITABLE_META.includes(change.field as WritableMetaKey),
    )
    .map((change) => ({ key: change.field as WritableMetaKey, value: change.after }));

  const body: Record<string, unknown> = {};
  if (metaData.length > 0) body.meta_data = metaData;

  // Only ever draft -> publish. A live product is never taken down from here.
  if (
    target.status === "draft" &&
    changes.some((change) => change.field === "status")
  ) {
    body.status = "publish";
  }

  const categoryChange = changes.find((change) => change.field === "categories");
  let categoryNote = "";
  if (categoryChange && needsBrandCategory(target)) {
    // Same inputs the plan used, so the preview and the write cannot disagree
    // about which brand this is.
    const brand = inferBrand(proposal, target.name);
    const resolved = brand ? await ensureBrandCategory(credentials, brand) : null;
    if (resolved?.ok) {
      // Replacing the whole set is the intent here: the only thing being
      // replaced is Uncategorized, or nothing at all.
      body.categories = [{ id: resolved.category.id }];
      categoryChange.after = resolved.category.name;
    } else if (resolved) {
      categoryNote = ` The brand category could not be set: ${resolved.reason}`;
    }
  }

  // Everything already matched. That is a success, not a failure — the state
  // the recommendation asked for is the state the store is in.
  if (Object.keys(body).length === 0) {
    return {
      ok: true,
      mode: "update",
      target,
      applied: [],
      revisionHint: `product ${target.id} (${target.name}) was already up to date — nothing was written.`,
    };
  }

  const response = await wooFetch(credentials, `/products/${target.id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!response.ok) return { ok: false, reason: await describeFailure(response) };

  return {
    ok: true,
    mode: "update",
    target,
    applied: changes,
    revisionHint: `product ${target.id} (${target.name}) — previous SEO values are recorded in this recommendation's job events.${categoryNote}`,
  };
}

/**
 * Publish: update what exists, create what does not.
 *
 * The plan is rebuilt here rather than carried over from an earlier preview,
 * because the product may have changed since — writing a stale plan would
 * overwrite whatever that change was.
 */
export async function publish(
  credentials: WooCredentials,
  targetUrl: string,
  proposal: OptimizeProposal,
  options: PublishOptions,
): Promise<ApplyResult> {
  const planned = await plan(credentials, targetUrl, proposal, options);
  if (!planned.ok) return { ok: false, reason: planned.reason };

  if (planned.mode === "create") {
    return createProduct(credentials, planned.slug, targetUrl, proposal);
  }

  const target = await resolveProduct(credentials, targetUrl);
  if (!target.ok) return { ok: false, reason: target.reason };
  return updateProduct(credentials, target.target, planned.changes, proposal);
}
