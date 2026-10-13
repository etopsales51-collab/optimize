import { z } from "zod";

import type { WordpressCredentials } from "./wordpressAdapter";

export type ResolvedWpObject = {
  objectType: "post" | "term";
  restBase: string;
  subtype: string;
  id: number;
  link: string;
  status?: string;
  title: string;
  parentId?: number;
  contentRaw: string;
  modifiedGmt: string | null;
  isFrontPage?: boolean;
};

export type ResolveWpObjectResult =
  | { ok: true; target: ResolvedWpObject | null; tried: string[] }
  | { ok: false; reason: string };

const TIMEOUT = 20_000;
const ANY_STATUS = "publish,future,draft,pending,private";

function auth(credentials: WordpressCredentials) {
  const bytes = new TextEncoder().encode(
    `${credentials.username}:${credentials.appPassword}`,
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

async function api(
  credentials: WordpressCredentials,
  path: string,
): Promise<Response> {
  return fetch(`${credentials.baseUrl.replace(/\/+$/, "")}/wp-json${path}`, {
    headers: { Authorization: auth(credentials), Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
}

function parts(value: string): string[] | null {
  try {
    return new URL(value).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
}

export function sameWpPath(a: string, b: string): boolean {
  const left = parts(a);
  const right = parts(b);
  return left !== null && right !== null && left.join("/") === right.join("/");
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const row = value as { raw?: unknown; rendered?: unknown };
    return typeof row.raw === "string"
      ? row.raw
      : typeof row.rendered === "string"
        ? row.rendered
        : "";
  }
  return "";
}

function normalize(
  row: Record<string, unknown>,
  objectType: "post" | "term",
  restBase: string,
  subtype: string,
  fallbackLink: string,
): ResolvedWpObject | null {
  const id = Number(row.id);
  if (!id) return null;
  return {
    objectType,
    restBase,
    subtype,
    id,
    link: typeof row.link === "string" ? row.link : fallbackLink,
    status: typeof row.status === "string" ? row.status : undefined,
    title: text(row.title) || String(row.name ?? ""),
    parentId: Number(row.parent) || undefined,
    contentRaw:
      objectType === "term" ? String(row.description ?? "") : text(row.content),
    modifiedGmt: typeof row.modified_gmt === "string" ? row.modified_gmt : null,
  };
}

async function getOne(
  credentials: WordpressCredentials,
  restBase: string,
  id: number,
  objectType: "post" | "term",
  subtype: string,
  targetUrl: string,
): Promise<ResolvedWpObject | null> {
  let response = await api(
    credentials,
    `/wp/v2/${restBase}/${id}?context=edit`,
  );
  // Taxonomy records are commonly public while context=edit requires
  // manage_terms/manage_product_terms. The live URL already identified the
  // exact object, so use its public representation for preview/resolution and
  // let the write return the actionable capability error if access is lacking.
  if (response.status === 401 || response.status === 403) {
    response = await api(credentials, `/wp/v2/${restBase}/${id}`);
  }
  if (!response.ok) return null;
  const row = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!row) return null;
  const detectedType =
    objectType === "term" ||
    ("description" in row && "name" in row && !("content" in row))
      ? "term"
      : "post";
  const target = normalize(row, detectedType, restBase, subtype, targetUrl);
  return target && sameWpPath(target.link, targetUrl) ? target : null;
}

function endpointFromHtml(
  html: string,
  headers: Headers,
): { restBase: string; id: number } | null {
  const candidates = [
    headers.get("Link") ?? "",
    ...html.matchAll(/<link\b[^>]*rel=["'][^"']*alternate[^"']*["'][^>]*>/gi),
  ].map((value) => (typeof value === "string" ? value : value[0]));
  for (const candidate of candidates) {
    const match = candidate.match(/\/wp-json\/wp\/v2\/([^?"'<>\s,]+)\/(\d+)/i);
    if (match)
      return { restBase: decodeURIComponent(match[1]), id: Number(match[2]) };
  }
  return null;
}

function identityFromBody(
  html: string,
): { restBase: string; id: number } | null {
  const className =
    html.match(/<body\b[^>]*class=["']([^"']*)["']/i)?.[1] ?? "";
  const page = className.match(/\bpage-id-(\d+)\b/);
  if (page) return { restBase: "pages", id: Number(page[1]) };
  const post = className.match(/\bpostid-(\d+)\b/);
  if (post) return { restBase: "posts", id: Number(post[1]) };
  const term = className.match(/\btax-([^\s]+).*?\bterm-(\d+)\b/);
  if (term) return { restBase: term[1], id: Number(term[2]) };
  const category = className.match(/\bcategory-(\d+)\b/);
  if (category) return { restBase: "categories", id: Number(category[1]) };
  const tag = className.match(/\btag-(\d+)\b/);
  return tag ? { restBase: "tags", id: Number(tag[1]) } : null;
}

async function parentPathMatches(
  credentials: WordpressCredentials,
  restBase: string,
  row: Record<string, unknown>,
  targetUrl: string,
): Promise<boolean> {
  const segments = parts(targetUrl) ?? [];
  const slug = String(row.slug ?? "");
  const leaf = segments.lastIndexOf(slug);
  if (leaf < 0) return false;
  const expected = segments.slice(0, leaf).reverse();
  let parent = Number(row.parent) || 0;
  for (const expectedSlug of expected) {
    if (!parent) break;
    const response = await api(
      credentials,
      `/wp/v2/${restBase}/${parent}?context=edit`,
    );
    if (!response.ok) return false;
    const ancestor = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (String(ancestor.slug ?? "") !== expectedSlug) return false;
    parent = Number(ancestor.parent) || 0;
  }
  return true;
}

const discoverySchema = z.record(
  z.string(),
  z.object({ rest_base: z.string().optional() }).passthrough(),
);

export async function resolveWpObject(
  credentials: WordpressCredentials,
  targetUrl: string,
): Promise<ResolveWpObjectResult> {
  const segments = parts(targetUrl);
  if (!segments) return { ok: false, reason: `Not a valid URL: ${targetUrl}` };
  const tried: string[] = [];

  if (segments.length === 0) {
    tried.push("settings (front page)");
    const settings = await api(credentials, "/wp/v2/settings");
    if (settings.ok) {
      const row = (await settings.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (row.show_on_front === "posts") {
        return {
          ok: false,
          reason: "Home page shows latest posts; there is no page to edit.",
        };
      }
      const id = Number(row.page_on_front);
      if (row.show_on_front === "page" && id) {
        const target = await getOne(
          credentials,
          "pages",
          id,
          "post",
          "page",
          targetUrl,
        );
        if (target)
          return { ok: true, target: { ...target, isFrontPage: true }, tried };
      }
    }
  }

  try {
    const live = await fetch(targetUrl, {
      headers: { Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (live.ok) {
      const html = (await live.text()).slice(0, 500_000);
      const identity =
        endpointFromHtml(html, live.headers) ?? identityFromBody(html);
      if (identity) {
        tried.push(`${identity.restBase}/${identity.id} (live URL)`);
        const taxonomyNames = new Set([
          "categories",
          "tags",
          "product_cat",
          "product_tag",
        ]);
        let subtype = identity.restBase;
        const taxonomyResponse = await api(credentials, "/wp/v2/taxonomies");
        const taxonomyParsed = discoverySchema.safeParse(
          await taxonomyResponse.json().catch(() => ({})),
        );
        if (taxonomyParsed.success) {
          for (const [name, value] of Object.entries(taxonomyParsed.data)) {
            if ((value.rest_base ?? name) === identity.restBase) {
              taxonomyNames.add(identity.restBase);
              subtype = name;
              break;
            }
          }
        }
        const objectType = taxonomyNames.has(identity.restBase)
          ? "term"
          : "post";
        const target = await getOne(
          credentials,
          subtype,
          identity.id,
          objectType,
          identity.restBase,
          targetUrl,
        );
        if (target)
          return {
            ok: true,
            target: { ...target, isFrontPage: segments.length === 0 },
            tried,
          };
      }
    }
  } catch {
    // REST discovery below remains authoritative when the public page is unavailable.
  }

  if (segments.length === 0) return { ok: true, target: null, tried };
  const slug = segments.at(-1) ?? "";
  const [typesResponse, taxonomiesResponse] = await Promise.all([
    api(credentials, "/wp/v2/types"),
    api(credentials, "/wp/v2/taxonomies"),
  ]);
  const typesParsed = discoverySchema.safeParse(
    await typesResponse.json().catch(() => ({})),
  );
  const taxParsed = discoverySchema.safeParse(
    await taxonomiesResponse.json().catch(() => ({})),
  );
  const discoveredTypes =
    typesParsed.success && Object.keys(typesParsed.data).length
      ? typesParsed.data
      : { post: { rest_base: "posts" }, page: { rest_base: "pages" } };
  const endpoints = [
    ...Object.entries(discoveredTypes).map(([subtype, value]) => ({
      objectType: "post" as const,
      subtype,
      restBase: value.rest_base ?? `${subtype}s`,
    })),
    ...Object.entries(taxParsed.success ? taxParsed.data : {}).map(
      ([subtype, value]) => ({
        objectType: "term" as const,
        subtype,
        restBase: value.rest_base ?? subtype,
      }),
    ),
  ];

  for (const endpoint of endpoints) {
    tried.push(endpoint.subtype);
    const query = new URLSearchParams({
      slug,
      context: "edit",
      per_page: "100",
    });
    if (endpoint.objectType === "post") query.set("status", ANY_STATUS);
    const response = await api(
      credentials,
      `/wp/v2/${endpoint.restBase}?${query}`,
    );
    if (!response.ok) continue;
    const rows = (await response.json().catch(() => [])) as Record<
      string,
      unknown
    >[];
    for (const row of Array.isArray(rows) ? rows : []) {
      const pathMatches =
        typeof row.link === "string" && sameWpPath(row.link, targetUrl);
      const draftFallback =
        endpoint.objectType === "post" &&
        row.status !== "publish" &&
        rows.length === 1;
      const nestedTerm =
        endpoint.objectType === "term" &&
        (await parentPathMatches(
          credentials,
          endpoint.restBase,
          row,
          targetUrl,
        ));
      if (!pathMatches && !draftFallback && !nestedTerm) continue;
      const target = normalize(
        row,
        endpoint.objectType,
        endpoint.restBase,
        endpoint.subtype,
        targetUrl,
      );
      if (target) return { ok: true, target, tried };
    }
  }

  return { ok: true, target: null, tried };
}
