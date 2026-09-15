import { buildArticleBodyHtml } from "@/shared/articleHtml";
import type { ArticleImage, OptimizeProposal } from "@/shared/optimize";

/**
 * WordPress REST adapter for pages and blog posts: every URL that is not a
 * WooCommerce product. Works for any project that saves a WordPress username
 * and application password; nothing here is specific to one site.
 *
 * CREATE OR UPDATE IS DECIDED BY THE SITE
 * The target URL's last path segment is looked up as a post slug and then a
 * page slug, drafts included, so re-publishing a brief finds what the first
 * publish created instead of duplicating it. As with products, a
 * recommendation's type only decides whether creating is PERMITTED.
 *
 * WHAT IT WRITES
 * On an existing post or page, the same narrow set as products:
 *   proposal.title           -> rank_math_title
 *   proposal.metaDescription -> rank_math_description
 *   primaryQuery             -> rank_math_focus_keyword
 *   status: draft -> publish, and only in that direction
 * Never its title, body, author, slug or date: body sections on an existing
 * page are applied by hand, as for products.
 *
 * A new one is created from a brief: its images are uploaded to the media
 * library first (the hero becomes the featured image), then the post, with its
 * title from the H1 and its body from shared/articleHtml.ts, the same builder
 * the in-app article preview uses. It is published, filed under a matching
 * category when the site has one, then the Rank Math fields are written.
 *
 * POST OR PAGE
 * Decided by the site's own permalinks, read from its newest post: if the
 * target URL sits where the site puts posts (e.g. /slug/ or /blog/slug/), it
 * becomes a post; a top-level URL on a site whose posts live elsewhere becomes
 * a page. A nested page URL is refused, because its parent would be a guess.
 *
 * SEO FIELDS GO THROUGH RANK MATH
 * WordPress does not expose Rank Math's meta in /wp/v2, so they are written
 * with Rank Math's own rankmath/v1/updateMeta. A site without Rank Math still
 * gets its post; the result says the SEO fields were not written.
 */

export type WordpressCredentials = {
  baseUrl: string;
  username: string;
  appPassword: string;
};

export type ContentKind = "post" | "page";

export type WpPlannedChange = {
  field:
    | "rank_math_title"
    | "rank_math_description"
    | "rank_math_focus_keyword"
    | "title"
    | "content"
    | "images"
    | "status"
    | "categories";
  label: string;
  before: string;
  after: string;
};

export type ResolvedContent = {
  id: number;
  kind: ContentKind;
  title: string;
  link: string;
  status: string;
};

export type WpPlan =
  | {
      ok: true;
      mode: "create" | "update";
      kind: ContentKind;
      slug: string;
      target: ResolvedContent | null;
      categoryId: number | null;
      changes: WpPlannedChange[];
    }
  | { ok: false; reason: string };

export type LoadedImage = { bytes: ArrayBuffer; contentType: string };

export type WpPublishOptions = {
  allowCreate: boolean;
  focusKeyword?: string | null;
  /** Reads the stored bytes of an image; null when it has none yet. */
  loadImage?: (image: ArticleImage) => Promise<LoadedImage | null>;
};

export type WpApplyResult =
  | {
      ok: true;
      mode: "create" | "update";
      target: ResolvedContent;
      applied: WpPlannedChange[];
      revisionHint: string;
    }
  | { ok: false; reason: string };

const REQUEST_TIMEOUT_MS = 20_000;
const ANY_STATUS = "publish,future,draft,pending,private";

type Category = { id: number; name: string; count: number };

function authHeader(credentials: WordpressCredentials): string {
  const raw = `${credentials.username}:${credentials.appPassword}`;
  let binary = "";
  for (const byte of new TextEncoder().encode(raw)) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
}

function wpFetch(
  credentials: WordpressCredentials,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = credentials.baseUrl.replace(/\/+$/, "");
  return fetch(`${base}/wp-json${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
      Authorization: authHeader(credentials),
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** Readable reason, with the credential never echoed back. */
async function describeFailure(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    return `WordPress rejected the credentials (${response.status}). Check the username and application password in Project settings → Publishing, and that the user is an Editor.`;
  }
  const body = await response.text().catch(() => "");
  return `WordPress returned ${response.status}. ${body.slice(0, 200)}`;
}

function pathSegments(url: string): string[] | null {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
}

function samePath(a: string, b: string): boolean {
  const left = pathSegments(a);
  const right = pathSegments(b);
  return left !== null && right !== null && left.join("/") === right.join("/");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#124;/g, "|");
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Find the post or page at this URL, drafts included. */
export async function resolveContent(
  credentials: WordpressCredentials,
  targetUrl: string,
): Promise<
  | { ok: true; target: ResolvedContent | null }
  | { ok: false; reason: string }
> {
  const segments = pathSegments(targetUrl);
  if (segments === null) return { ok: false, reason: `Not a valid URL: ${targetUrl}` };
  const slug = segments[segments.length - 1];
  if (!slug) {
    return { ok: false, reason: "That URL is the home page, which is not published from here." };
  }

  for (const kind of ["post", "page"] as const) {
    const response = await wpFetch(
      credentials,
      `/wp/v2/${kind}s?slug=${encodeURIComponent(slug)}&status=${ANY_STATUS}&context=edit&per_page=10&_fields=id,link,status,title`,
    );
    if (!response.ok) return { ok: false, reason: await describeFailure(response) };

    const rows = (await response.json().catch(() => [])) as Array<{
      id?: number;
      link?: string;
      status?: string;
      title?: { raw?: string; rendered?: string };
    }>;
    if (!Array.isArray(rows) || rows.length === 0) continue;

    // Two pages under different parents can share a slug; prefer the one
    // whose live path is the target. Drafts have no pretty link yet.
    const row =
      rows.find((entry) => entry.link && samePath(entry.link, targetUrl)) ??
      rows.find((entry) => entry.status !== "publish") ??
      (rows.length === 1 ? rows[0] : undefined);
    if (!row?.id) continue;

    return {
      ok: true,
      target: {
        id: row.id,
        kind,
        title: row.title?.raw ?? decodeEntities(row.title?.rendered ?? ""),
        link: row.link ?? targetUrl,
        status: row.status ?? "publish",
      },
    };
  }

  return { ok: true, target: null };
}

/**
 * The SEO title and description a published URL currently shows, read from
 * its HTML head. Only for the preview's "before" column; Rank Math does not
 * return its stored fields over REST.
 */
async function readLiveHead(
  url: string,
): Promise<{ title: string; description: string }> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { title: "", description: "" };
    const html = (await response.text()).slice(0, 200_000);
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "";
    const description =
      html.match(
        /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
      )?.[1] ??
      html.match(
        /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i,
      )?.[1] ??
      "";
    return {
      title: decodeEntities(title.trim()),
      description: decodeEntities(description.trim()),
    };
  } catch {
    return { title: "", description: "" };
  }
}

/**
 * Where this site puts posts: the path of its newest post minus the slug.
 * "" for /slug/, "blog" for /blog/slug/, null when it has no posts or uses
 * dated permalinks we should not imitate.
 */
async function postPathPrefix(
  credentials: WordpressCredentials,
): Promise<string | null> {
  const response = await wpFetch(
    credentials,
    "/wp/v2/posts?per_page=1&status=publish&_fields=link",
  );
  if (!response.ok) return null;
  const rows = (await response.json().catch(() => [])) as Array<{ link?: string }>;
  const segments = rows[0]?.link ? pathSegments(rows[0].link) : null;
  if (!segments || segments.length === 0) return null;
  const prefix = segments.slice(0, -1);
  if (prefix.some((segment) => /^\d+$/.test(segment))) return null;
  return prefix.join("/");
}

function wordsOf(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
    .map((word) => word.replace(/(es|s)$/, ""));
}

/**
 * The existing category that best matches the brief, by shared words in the
 * name, H1 and primary query ("passport scanner" → "Passport Scanners").
 * Never creates a category, and picks nothing rather than a weak guess.
 */
export function matchPostCategory(
  categories: Category[],
  text: string,
): Category | null {
  const wanted = new Set(wordsOf(text));
  let best: { category: Category; score: number } | null = null;
  for (const category of categories) {
    const words = wordsOf(category.name);
    if (words.length === 0) continue;
    const shared = words.filter((word) => wanted.has(word)).length;
    // Every word of a one-word name, or at least two words of a longer one.
    const strong = shared === words.length || shared >= 2;
    if (!strong) continue;
    if (
      !best ||
      shared > best.score ||
      (shared === best.score && category.count > best.category.count)
    ) {
      best = { category, score: shared };
    }
  }
  return best?.category ?? null;
}

async function findPostCategory(
  credentials: WordpressCredentials,
  text: string,
): Promise<Category | null> {
  const response = await wpFetch(
    credentials,
    "/wp/v2/categories?per_page=100&_fields=id,name,count",
  );
  if (!response.ok) return null;
  const rows = (await response.json().catch(() => [])) as Array<{
    id?: number;
    name?: string;
    count?: number;
  }>;
  const categories = (Array.isArray(rows) ? rows : []).flatMap((row) =>
    typeof row.id === "number"
      ? [{ id: row.id, name: decodeEntities(row.name ?? ""), count: row.count ?? 0 }]
      : [],
  );
  return matchPostCategory(categories, text);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function seoChanges(
  proposal: OptimizeProposal,
  focusKeyword: string | null,
  current: { title: string; description: string },
): WpPlannedChange[] {
  const changes: WpPlannedChange[] = [];
  const title = proposal.title?.after?.trim();
  if (title && title !== current.title) {
    changes.push({ field: "rank_math_title", label: "SEO title", before: current.title, after: title });
  }
  const description = proposal.metaDescription?.after?.trim();
  if (description && description !== current.description) {
    changes.push({
      field: "rank_math_description",
      label: "Meta description",
      before: current.description,
      after: description,
    });
  }
  if (focusKeyword) {
    changes.push({
      field: "rank_math_focus_keyword",
      label: "Focus keyword",
      before: "",
      after: focusKeyword,
    });
  }
  return changes;
}

/** What publishing would do. Reads only. */
export async function plan(
  credentials: WordpressCredentials,
  targetUrl: string,
  proposal: OptimizeProposal,
  options: WpPublishOptions,
): Promise<WpPlan> {
  const focusKeyword = options.focusKeyword?.trim() || null;
  const resolved = await resolveContent(credentials, targetUrl);
  if (!resolved.ok) return resolved;
  const segments = pathSegments(targetUrl) ?? [];
  const slug = segments[segments.length - 1] ?? "";

  // ---- Update ------------------------------------------------------------
  if (resolved.target) {
    const target = resolved.target;
    const current =
      target.status === "publish"
        ? await readLiveHead(target.link)
        : { title: "", description: "" };
    const changes = seoChanges(proposal, focusKeyword, current);
    if (target.status === "draft" || target.status === "pending") {
      changes.push({ field: "status", label: "Status", before: target.status, after: "publish" });
    }
    return { ok: true, mode: "update", kind: target.kind, slug, target, categoryId: null, changes };
  }

  // ---- Create ------------------------------------------------------------
  if (!options.allowCreate) {
    return {
      ok: false,
      reason: `Nothing exists at "${slug}" to update. If this URL should be created, ask the agent to send it as a new page brief.`,
    };
  }

  const title = proposal.h1?.after?.trim();
  if (!title) {
    return { ok: false, reason: "This brief has no H1, so there is no title to create. Ask the agent to add one." };
  }

  const prefix = segments.slice(0, -1).join("/");
  const postPrefix = await postPathPrefix(credentials);
  let kind: ContentKind;
  if (postPrefix !== null && prefix === postPrefix) {
    kind = "post";
  } else if (segments.length === 1) {
    kind = "page";
  } else {
    return {
      ok: false,
      reason: `"${segments.join("/")}" is neither where this site puts blog posts${postPrefix ? ` (/${postPrefix}/…)` : ""} nor a top-level page, so its parent page would be a guess. Create it in WordPress, then publish again to write the SEO fields.`,
    };
  }

  const category =
    kind === "post"
      ? await findPostCategory(credentials, `${title} ${focusKeyword ?? ""}`)
      : null;

  const body = buildArticleBodyHtml(proposal, { imageSource: () => null, placeholders: false });
  const sectionCount = proposal.sections.filter((section) => section.after?.trim()).length;
  const images = proposal.images ?? [];
  const ready = images.filter((image) => image.assetId || image.url);
  const emptySlots = images.length - ready.length;
  const hasHero = ready.some((image) => image.role === "hero");
  const changes: WpPlannedChange[] = [
    { field: "title", label: kind === "post" ? "Post title" : "Page title", before: "(does not exist)", after: title },
    ...(body
      ? [{
          field: "content" as const,
          label: "Body content",
          before: "",
          after: `${sectionCount} section${sectionCount === 1 ? "" : "s"}`,
        }]
      : []),
    ...(images.length
      ? [{
          field: "images" as const,
          label: "Images",
          before: "",
          after: [
            `${ready.length} to upload${hasHero ? " (hero as featured image)" : ""}`,
            emptySlots ? `${emptySlots} empty slot${emptySlots === 1 ? "" : "s"} skipped` : "",
          ]
            .filter(Boolean)
            .join(", "),
        }]
      : []),
    ...(category
      ? [{ field: "categories" as const, label: "Category", before: "(none)", after: category.name }]
      : []),
    ...seoChanges(proposal, focusKeyword, { title: "", description: "" }),
  ];

  return { ok: true, mode: "create", kind, slug, target: null, categoryId: category?.id ?? null, changes };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Write the Rank Math fields. Returns a note when they could not be written. */
async function writeSeoMeta(
  credentials: WordpressCredentials,
  id: number,
  changes: WpPlannedChange[],
): Promise<string> {
  const meta = Object.fromEntries(
    changes
      .filter((change) => change.field.startsWith("rank_math_"))
      .map((change) => [change.field, change.after]),
  );
  if (Object.keys(meta).length === 0) return "";

  const response = await wpFetch(credentials, "/rankmath/v1/updateMeta", {
    method: "POST",
    body: JSON.stringify({ objectType: "post", objectID: id, meta }),
  });
  if (response.ok) return "";
  if (response.status === 404) {
    return " The SEO fields were not written: Rank Math is not active on this site.";
  }
  return ` The SEO fields were not written: ${await describeFailure(response)}`;
}

/**
 * Upload a brief's images to the media library. An image that fails is left
 * out of the post and reported, rather than failing a post that is otherwise
 * ready.
 */
async function uploadImages(
  credentials: WordpressCredentials,
  slug: string,
  images: ArticleImage[],
  loadImage: WpPublishOptions["loadImage"],
): Promise<{ sources: Map<string, string>; featuredId: number | null; notes: string[] }> {
  const sources = new Map<string, string>();
  const notes: string[] = [];
  let featuredId: number | null = null;

  for (const image of images) {
    if (!image.assetId && !image.url) continue;
    const loaded = loadImage ? await loadImage(image) : null;
    if (!loaded) {
      notes.push(`${image.slotId} could not be read`);
      continue;
    }
    const extension = (loaded.contentType.split("/")[1] ?? "img").replace("jpeg", "jpg");
    const upload = await wpFetch(credentials, "/wp/v2/media", {
      method: "POST",
      headers: {
        "Content-Type": loaded.contentType,
        "Content-Disposition": `attachment; filename="${slug}-${image.slotId}.${extension}"`,
      },
      body: loaded.bytes,
    });
    const media = upload.ok
      ? ((await upload.json().catch(() => ({}))) as { id?: number; source_url?: string })
      : {};
    if (!media.id || !media.source_url) {
      notes.push(`${image.slotId} was not uploaded (${upload.status})`);
      continue;
    }
    // Alt text and caption are fields of the media item, not of the upload.
    await wpFetch(credentials, `/wp/v2/media/${media.id}`, {
      method: "POST",
      body: JSON.stringify({ alt_text: image.alt, caption: image.caption ?? "" }),
    });
    sources.set(image.slotId, media.source_url);
    if (image.role === "hero") featuredId = media.id;
  }

  return { sources, featuredId, notes };
}

/**
 * Publish: update what exists, create what does not. The plan is rebuilt here
 * rather than trusted from an earlier preview, because the site may have
 * changed since.
 */
export async function publish(
  credentials: WordpressCredentials,
  targetUrl: string,
  proposal: OptimizeProposal,
  options: WpPublishOptions,
): Promise<WpApplyResult> {
  const planned = await plan(credentials, targetUrl, proposal, options);
  if (!planned.ok) return planned;
  const collection = `/wp/v2/${planned.kind}s`;

  if (planned.mode === "update" && planned.target) {
    const target = planned.target;
    if (planned.changes.some((change) => change.field === "status")) {
      const response = await wpFetch(credentials, `${collection}/${target.id}`, {
        method: "POST",
        body: JSON.stringify({ status: "publish" }),
      });
      if (!response.ok) return { ok: false, reason: await describeFailure(response) };
    }
    const seoNote = await writeSeoMeta(credentials, target.id, planned.changes);
    return {
      ok: true,
      mode: "update",
      target: { ...target, status: "publish" },
      applied: planned.changes,
      revisionHint: `${target.kind} ${target.id} (${target.title}). Previous SEO values are recorded in this recommendation's job events.${seoNote}`,
    };
  }

  const title = proposal.h1?.after?.trim() ?? "";
  const uploaded = await uploadImages(
    credentials,
    planned.slug,
    proposal.images ?? [],
    options.loadImage,
  );
  const response = await wpFetch(credentials, collection, {
    method: "POST",
    body: JSON.stringify({
      title,
      slug: planned.slug,
      status: "publish",
      content: buildArticleBodyHtml(proposal, {
        imageSource: (image) => uploaded.sources.get(image.slotId) ?? null,
        placeholders: false,
      }),
      ...(uploaded.featuredId ? { featured_media: uploaded.featuredId } : {}),
      ...(planned.categoryId ? { categories: [planned.categoryId] } : {}),
    }),
  });
  if (!response.ok) return { ok: false, reason: await describeFailure(response) };

  const created = (await response.json().catch(() => ({}))) as { id?: number; link?: string };
  if (!created.id) return { ok: false, reason: "WordPress did not return an id for the new post." };

  const seoNote = await writeSeoMeta(credentials, created.id, planned.changes);
  const target: ResolvedContent = {
    id: created.id,
    kind: planned.kind,
    title,
    link: created.link ?? targetUrl,
    status: "publish",
  };
  // WordPress changes a taken slug (adds -2); say so rather than let the
  // recommendation point at a URL that does not exist.
  const slugNote =
    created.link && !samePath(created.link, targetUrl)
      ? ` WordPress published it at ${created.link}, not the requested URL.`
      : "";

  return {
    ok: true,
    mode: "create",
    target,
    applied: planned.changes,
    revisionHint: `Created and published ${planned.kind} ${created.id}.${slugNote}${seoNote}${
      uploaded.notes.length ? ` Images: ${uploaded.notes.join("; ")}.` : ""
    }`,
  };
}
