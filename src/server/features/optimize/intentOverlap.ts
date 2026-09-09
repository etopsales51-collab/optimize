import type { CannibalizationCheck } from "@/shared/optimize";

/**
 * Part H, as code: does an existing page already own this intent?
 *
 * The rule this enforces — "mail management system" and "mail management
 * solution" are ONE intent and must not become two URLs — is a rule about
 * meaning, not spelling. So before comparing, tokens are folded through a small
 * synonym table (system ≈ solution ≈ software ≈ app ≈ platform), stopwords
 * are dropped and trailing plurals trimmed. After folding, both phrases reduce
 * to {mail, management, product} and score 1.0 against each other.
 *
 * Pure and deterministic: no network, no credits. The inputs are the latest
 * audit's pages (title, og:title, meta description, URL path). H1 text is not
 * persisted by the crawler, so the "title_h1_overlap" method here is title +
 * og:title + path, which on WordPress product pages is the H1 in practice.
 *
 * Redirect-source rows are skipped. The crawler records /path (301) and
 * /path/ (200) separately on purpose; only the 200 row is a page, and the 301
 * row has no title anyway.
 */

export type CrawlPage = {
  url: string;
  statusCode: number | null;
  redirectUrl?: string | null;
  fetchClass?: string | null;
  title: string | null;
  ogTitle?: string | null;
  metaDescription?: string | null;
  inSitemap?: boolean | null;
  internalLinkCount?: number | null;
};

export type OverlapMatch = {
  url: string;
  title: string | null;
  similarity: number;
  reason: string;
};

export type IntentOverlapResult = {
  intentKey: string;
  existingUrls: OverlapMatch[];
  recommendation: "optimize_existing" | "merge_pages" | "new_page_allowed";
  keepUrl?: string;
  mergeFromUrls?: string[];
  /** Ready to paste into create_optimize_recommendation.cannibalizationCheck. */
  cannibalizationCheck: CannibalizationCheck;
};

// Words that carry no intent on their own.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "by",
  "at", "from", "is", "are", "be", "your", "our", "you", "we", "it", "this",
  "that", "best", "top", "buy", "price", "prices", "online", "shop", "store",
  "uae", "dubai", "abu", "dhabi", "sharjah", "ae", "com", "www", "official",
  "home", "page", "product", "products", "category",
]);

// Near-duplicate intents. Every entry on a line folds to the first word, so
// "system" and "solution" and "software" become the same token. Extend this
// as the playbook meets new cases; each row is one documented decision.
const SYNONYMS: Record<string, string> = Object.fromEntries(
  [
    ["offering", "system", "solution", "solutions", "software", "app", "application", "apps", "platform", "tool", "tools", "suite"],
    ["signature", "sign", "signing", "signatures", "esign", "esignature", "e-signature", "e-sign"],
    ["tablet", "tablets", "pad", "pads", "slate"],
    ["display", "displays", "monitor", "monitors", "screen", "screens"],
    ["pen", "pens", "stylus", "styluses"],
    ["driver", "drivers", "download", "downloads", "setup", "install", "installation"],
    ["comparison", "compare", "vs", "versus", "difference", "differences"],
    ["guide", "guides", "howto", "tutorial", "tutorials", "manual"],
    ["mail", "mails", "email", "emails", "post", "letter", "letters"],
    ["management", "manage", "managing", "manager", "tracking", "track"],
  ].flatMap((row) => row.map((word) => [word, row[0]] as const)),
);

// How much overlap is "the same intent". Above STRONG the page already owns
// it; between PARTIAL and STRONG it is worth telling the agent about.
const STRONG = 0.5;
const PARTIAL = 0.25;

export function intentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 2) continue;
    if (STOPWORDS.has(raw)) continue;
    let token = SYNONYMS[raw] ?? raw;
    // Crude but sufficient plural trim once synonyms are applied.
    if (!SYNONYMS[raw] && token.length > 4 && token.endsWith("s")) {
      token = token.slice(0, -1);
    }
    if (/^\d+$/.test(token)) continue;
    out.add(token);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function lastPathSegment(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1].replace(/-/g, " ") : "";
  } catch {
    return "";
  }
}

function isRealPage(page: CrawlPage): boolean {
  const status = page.statusCode ?? 0;
  if (status >= 300 && status < 400) return false;
  if (page.redirectUrl) return false;
  if (status !== 200) return false;
  if (page.fetchClass && page.fetchClass !== "html") return false;
  return true;
}

export function analyzeIntentOverlap(input: {
  query: string;
  pages: CrawlPage[];
  /** The URL the agent means to improve; excluded from "competing" pages. */
  draftUrl?: string | null;
}): IntentOverlapResult {
  const queryTokens = intentTokens(input.query);
  const intentKey = [...queryTokens].sort().join(" ");
  const draft = (input.draftUrl ?? "").replace(/\/+$/, "");

  const matches: OverlapMatch[] = [];
  for (const page of input.pages) {
    if (!isRealPage(page)) continue;
    if (draft && page.url.replace(/\/+$/, "") === draft) continue;

    // Title and og:title are the strongest signal; the path is next; the meta
    // description is weighted down because it is long and matches everything.
    const headline = intentTokens(
      `${page.title ?? ""} ${page.ogTitle ?? ""} ${lastPathSegment(page.url)}`,
    );
    const body = intentTokens(page.metaDescription ?? "");
    const score = Math.max(jaccard(queryTokens, headline), 0.6 * jaccard(queryTokens, body));
    if (score < PARTIAL) continue;

    const shared = [...queryTokens].filter((t) => headline.has(t) || body.has(t));
    matches.push({
      url: page.url,
      title: page.title,
      similarity: Number(score.toFixed(2)),
      reason: `shares intent tokens: ${shared.join(", ")}`,
    });
  }

  matches.sort((a, b) => b.similarity - a.similarity);
  const strong = matches.filter((m) => m.similarity >= STRONG);

  // Which page should survive a merge: most internally linked wins, sitemap
  // membership breaks ties — the proxies for "the page the site already
  // treats as canonical".
  const byUrl = new Map(input.pages.map((p) => [p.url, p]));
  const weight = (m: OverlapMatch) => {
    const p = byUrl.get(m.url);
    return (p?.internalLinkCount ?? 0) * 10 + (p?.inSitemap ? 1 : 0);
  };

  if (strong.length >= 2) {
    const ranked = [...strong].sort((a, b) => weight(b) - weight(a));
    const keepUrl = ranked[0].url;
    const mergeFromUrls = ranked.slice(1).map((m) => m.url);
    return {
      intentKey,
      existingUrls: matches,
      recommendation: "merge_pages",
      keepUrl,
      mergeFromUrls,
      cannibalizationCheck: {
        status: "merge_recommended",
        method: "title_h1_overlap",
        overlappingUrls: strong.map((m) => ({
          url: m.url,
          title: m.title ?? undefined,
          score: m.similarity,
          reason: m.reason,
        })),
        notes: `${strong.length} existing pages compete for "${input.query}". Keep ${keepUrl}; merge the rest into it with 301s. Do not create a new page.`,
      },
    };
  }

  if (strong.length === 1) {
    return {
      intentKey,
      existingUrls: matches,
      recommendation: "optimize_existing",
      keepUrl: strong[0].url,
      cannibalizationCheck: {
        status: "overlap_found",
        method: "title_h1_overlap",
        overlappingUrls: [
          {
            url: strong[0].url,
            title: strong[0].title ?? undefined,
            score: strong[0].similarity,
            reason: strong[0].reason,
          },
        ],
        notes: `${strong[0].url} already targets "${input.query}". Improve that page (content_refresh / on_page); do not create a new one.`,
      },
    };
  }

  return {
    intentKey,
    existingUrls: matches,
    recommendation: "new_page_allowed",
    cannibalizationCheck: {
      status: "clear",
      method: "title_h1_overlap",
      overlappingUrls: [],
      notes: matches.length
        ? `No page owns "${input.query}". ${matches.length} page(s) touch it partially (${matches.map((m) => m.url).join(", ")}); a new page is allowed but should link to and from them.`
        : `No existing page overlaps "${input.query}" across ${input.pages.length} crawled pages.`,
    },
  };
}
