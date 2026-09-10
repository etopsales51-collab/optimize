import type { PageLink } from "@/server/lib/audit/types";
import {
  PROJECT_CONTEXT_SECTION_KEYS,
  PROSE_MAX_CHARS,
  type ProjectContextSectionKey,
  type ProjectContextUpdate,
} from "@/types/schemas/projectContext";

/**
 * The pure half of "Fill from website": which pages count as key pages, and
 * which findings may be written. A leaf module on purpose, with no database or
 * Workers imports, so the two judgement calls here can be tested directly.
 */

export const MAX_KEY_PAGES_FROM_NAV = 8;

/** Paths that are navigation, not pages that carry the business. */
// Matched at the start of a path segment, so "privacy-policy" and "cart" are
// caught while "tagline" is not.
const NOISE_PATH =
  /(^|\/)(cart|checkout|my-account|account|login|wp-admin|privacy|terms|cookie|refund|shipping|sitemap|feed|tag|search|wishlist|compare)(-|_|\/|$)/i;

export type ContextFindings = {
  businessOverview?: string;
  positioning?: string;
  writingPreferences?: string;
  keyPages: { url: string; topic?: string }[];
};

/** Guessed sections are clipped so a verbose page cannot trip the cap. */
export function clip(value: string | undefined | null): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > PROSE_MAX_CHARS
    ? `${text.slice(0, PROSE_MAX_CHARS - 1)}…`
    : text;
}

/** The handful of internal pages a homepage points at, minus the plumbing. */
export function pickKeyPageCandidates(
  links: PageLink[],
  origin: string,
): { url: string; topic: string | undefined }[] {
  const seen = new Set<string>();
  const picked: { url: string; topic: string | undefined }[] = [];

  for (const link of links) {
    if (!link.isInternal) continue;
    let url: URL;
    try {
      url = new URL(link.targetUrl, origin);
    } catch {
      continue;
    }
    url.hash = "";
    url.search = "";
    const path = url.pathname.replace(/\/+$/, "");
    if (!path || NOISE_PATH.test(path)) continue;
    // One level deep reads as a section; deeper is an item inside one.
    if (path.split("/").filter(Boolean).length > 2) continue;

    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const anchor = link.anchor?.replace(/\s+/g, " ").trim();
    picked.push({
      url: `${origin}${path}`,
      topic: anchor && anchor.length <= 200 ? anchor : undefined,
    });
    if (picked.length >= MAX_KEY_PAGES_FROM_NAV) break;
  }

  return picked;
}

/**
 * Turn findings into patch ops, honouring what is already written. The
 * "never overwrite" rule lives here and nowhere else. The current goal is
 * never filled: a website does not say what its owner is pushing for.
 */
export function planContextFill(
  current: {
    missingSections: ProjectContextSectionKey[];
    keyPageCount: number;
  },
  findings: ContextFindings,
): { updates: ProjectContextUpdate[]; filled: string[]; left: string[] } {
  const updates: ProjectContextUpdate[] = [];
  const filled: string[] = [];
  const left: string[] = [];
  const missing = new Set(current.missingSections);

  const prose: Partial<Record<ProjectContextSectionKey, string | undefined>> = {
    business_overview: findings.businessOverview,
    positioning: findings.positioning,
    writing_preferences: findings.writingPreferences,
    current_goal: undefined,
  };

  for (const key of PROJECT_CONTEXT_SECTION_KEYS) {
    if (!missing.has(key)) continue;
    const content = clip(prose[key]);
    if (content) {
      updates.push({ section: key, content });
      filled.push(key);
    } else {
      left.push(key);
    }
  }

  if (current.keyPageCount === 0) {
    if (findings.keyPages.length > 0) {
      updates.push({
        addKeyPages: findings.keyPages.map((page) => ({
          url: page.url,
          role: "other" as const,
          topic: page.topic,
        })),
      });
      filled.push("key_pages");
    } else {
      left.push("key_pages");
    }
  }

  return { updates, filled, left };
}
