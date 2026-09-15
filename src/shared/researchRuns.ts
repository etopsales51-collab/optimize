/**
 * Research runs: a server-side record of research an agent did over MCP, so
 * staff can see it on the matching Research page.
 *
 * The pages' own "Recent searches" are each person's list (stored in the
 * database, see useLocalHistoryStore). Agent runs are shared with the whole
 * project, so they are logged separately and shown beside that list. Each run keeps the page's URL search params, so
 * "Open" lands on the page as if the search had been typed there — and because
 * the page and the MCP tool share one server cache key, a recent run opens from
 * cache instead of being bought again.
 *
 * Shared by the server (recording, MCP) and the client (the Agent runs list).
 * No server or Workers imports.
 */

/**
 * The page history lists kept in the database, by their localStorage key
 * prefix. A key is `<listKey>:<projectId>`.
 */
export const RESEARCH_HISTORY_LIST_KEYS = [
  "search-history",
  "domain-search-history",
  "backlinks-search-history",
  "brand-lookup-search-history",
  "prompt-explorer-search-history",
] as const;
export type ResearchHistoryListKey = (typeof RESEARCH_HISTORY_LIST_KEYS)[number];

/** Split a history storage key into its list and project, or null if it is not one. */
export function parseHistoryStorageKey(
  storageKey: string,
): { listKey: ResearchHistoryListKey; projectId: string } | null {
  const index = storageKey.lastIndexOf(":");
  if (index <= 0) return null;
  const listKey = storageKey.slice(0, index);
  const projectId = storageKey.slice(index + 1);
  if (!projectId) return null;
  return (RESEARCH_HISTORY_LIST_KEYS as readonly string[]).includes(listKey)
    ? { listKey: listKey as ResearchHistoryListKey, projectId }
    : null;
}

/** One value per Research page. */
export const RESEARCH_RUN_PAGES = [
  "keywords",
  "domain",
  "backlinks",
  "brand_lookup",
  "prompt_explorer",
] as const;
export type ResearchRunPage = (typeof RESEARCH_RUN_PAGES)[number];

export const RESEARCH_RUN_PAGE_PATHS = {
  keywords: "/p/$projectId/keywords",
  domain: "/p/$projectId/domain",
  backlinks: "/p/$projectId/backlinks",
  brand_lookup: "/p/$projectId/brand-lookup",
  prompt_explorer: "/p/$projectId/prompt-explorer",
} as const satisfies Record<ResearchRunPage, string>;

export type ResearchRunDraft = {
  page: ResearchRunPage;
  /** The exact MCP tool that produced it. */
  toolName: string;
  /** What was researched, as a person would say it. */
  target: string;
  /** The page's URL search params that reopen this run. */
  search: Record<string, string | number | boolean | string[]>;
};

type Args = Record<string, unknown>;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function withoutEmpty(
  search: Record<string, unknown>,
): ResearchRunDraft["search"] {
  return Object.fromEntries(
    Object.entries(search).filter(
      ([, value]) =>
        value !== undefined &&
        value !== null &&
        value !== "" &&
        !(Array.isArray(value) && value.length === 0),
    ),
  ) as ResearchRunDraft["search"];
}

/**
 * The runs an MCP tool call produced, or none for tools that are not page
 * research. A bulk call (several seeds or queries) records one run per item so
 * each opens on its own.
 */
export function researchRunsFromToolCall(
  toolName: string,
  args: Args,
): ResearchRunDraft[] {
  switch (toolName) {
    case "research_keywords": {
      const seeds = Array.isArray(args.seeds) ? args.seeds : [];
      return seeds.flatMap((row) => {
        const seed = text((row as Args).seed);
        const loc = (row as Args).locationCode;
        return seed
          ? [
              {
                page: "keywords" as const,
                toolName,
                target: seed,
                search: withoutEmpty({
                  q: seed,
                  loc: typeof loc === "number" ? loc : undefined,
                  kLimit: args.resultLimit,
                }),
              },
            ]
          : [];
      });
    }

    case "get_serp_results": {
      const queries = Array.isArray(args.queries) ? args.queries : [];
      return queries.flatMap((row) => {
        const keyword = text((row as Args).keyword);
        const loc = (row as Args).locationCode;
        return keyword
          ? [
              {
                page: "keywords" as const,
                toolName,
                target: `SERP: ${keyword}`,
                search: withoutEmpty({
                  q: keyword,
                  loc: typeof loc === "number" ? loc : undefined,
                }),
              },
            ]
          : [];
      });
    }

    case "get_domain_overview":
    case "get_domain_keyword_suggestions": {
      const domain = text(args.domain);
      if (!domain) return [];
      return [
        {
          page: "domain",
          toolName,
          target: domain,
          search: withoutEmpty({
            domain,
            scope: text(args.scope) ?? undefined,
            loc: typeof args.locationCode === "number" ? args.locationCode : undefined,
          }),
        },
      ];
    }

    case "get_backlinks_overview":
    case "get_backlinks_profile": {
      const target = text(args.target);
      if (!target) return [];
      return [
        {
          page: "backlinks",
          toolName,
          target,
          search: withoutEmpty({ target, scope: text(args.scope) ?? undefined }),
        },
      ];
    }

    case "run_brand_lookup": {
      const query = text(args.query);
      if (!query) return [];
      const competitors = Array.isArray(args.competitors)
        ? args.competitors.map(text).filter((v): v is string => v !== null)
        : [];
      return [
        {
          page: "brand_lookup",
          toolName,
          target: competitors.length ? `${query} vs ${competitors.join(", ")}` : query,
          search: withoutEmpty({
            q: query,
            c: competitors.join(","),
            scope: text(args.scope) ?? undefined,
          }),
        },
      ];
    }

    case "run_prompt_explorer": {
      const prompt = text(args.prompt);
      if (!prompt) return [];
      const country = text(args.webSearchCountryCode);
      return [
        {
          page: "prompt_explorer",
          toolName,
          target: prompt,
          // Mirrors how the Prompt Explorer route writes its own URL: web
          // search and US are defaults and stay out of the URL.
          search: withoutEmpty({
            q: prompt,
            models: Array.isArray(args.models) ? (args.models as string[]) : undefined,
            web: args.webSearch === false ? false : undefined,
            cc: country && country !== "US" ? country : undefined,
            hb: text(args.highlightBrand) ?? undefined,
          }),
        },
      ];
    }

    default:
      return [];
  }
}
