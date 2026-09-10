import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import { crawlPage } from "@/server/workflows/site-audit-workflow-helpers";
import { ProjectContextService } from "./ProjectContextService";
import {
  clip,
  MAX_KEY_PAGES_FROM_NAV,
  pickKeyPageCandidates,
  planContextFill,
  type ContextFindings,
} from "./contextAutofillPlan";

/**
 * "Fill from website": read the project's own domain and write down what it
 * says about itself, into the context fields that are still empty.
 *
 * Two passes, cheapest first:
 *
 *   1. The site itself, with the audit crawler already in this repo. One fetch
 *      of the homepage gives a title, a meta description and the navigation
 *      links. That is enough for a shortlist of key pages and a one-line
 *      overview, and it costs nothing.
 *   2. Firecrawl, when FIRECRAWL_API_KEY is set. One scrape of the homepage in
 *      JSON mode, with a schema, returns the prose the site pass cannot infer:
 *      what the business sells, why a buyer picks it, how it writes. One
 *      credit per press.
 *
 * Only EMPTY fields are written. Anything a person or an agent already wrote
 * stays exactly as it is; the button is for blanks, not a reset. What neither
 * pass can establish is reported back and left for a person. The current goal
 * and the competitor list are never guessed: a website does not say what its
 * owner is pushing for this quarter, and it does not name its rivals.
 */

export type ContextAutofillResult = {
  filled: string[];
  left: string[];
  /** Which pass produced the prose, so the toast can say where it came from. */
  source: "firecrawl" | "site" | "none";
  warnings: string[];
};

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
const FIRECRAWL_TIMEOUT_MS = 60_000;

function siteOrigin(domain: string): string {
  const bare = domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
  return `https://${bare}`;
}

// ---------------------------------------------------------------------------
// Firecrawl
// ---------------------------------------------------------------------------

const FIRECRAWL_SCHEMA = {
  type: "object",
  properties: {
    businessOverview: {
      type: "string",
      description:
        "Two or three plain sentences: what this business sells, who buys it, and where it operates. Facts from the page only.",
    },
    positioning: {
      type: "string",
      description:
        "One or two sentences on why a buyer would choose this business over alternatives, using only claims the site itself makes. Empty string if the site makes none.",
    },
    writingPreferences: {
      type: "string",
      description:
        "One or two sentences describing the site's own writing voice: formal or casual, technical or plain, first person or third. Describe, do not invent rules.",
    },
    keyPages: {
      type: "array",
      maxItems: MAX_KEY_PAGES_FROM_NAV,
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          topic: { type: "string" },
        },
        required: ["url"],
      },
      description:
        "Up to eight pages on this same site that carry the business: main product or service categories, key product lines, the about page. Absolute URLs.",
    },
  },
  required: ["businessOverview", "keyPages"],
} as const;

const FIRECRAWL_PROMPT =
  "You are filling in a factual profile of this business for its own marketing team. Use only what the page states. Do not add marketing language, do not guess figures, and leave a field empty rather than invent it.";

async function firecrawlFindings(
  apiKey: string,
  url: string,
): Promise<{ findings: ContextFindings | null; warning: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        onlyMainContent: false,
        formats: [
          { type: "json", schema: FIRECRAWL_SCHEMA, prompt: FIRECRAWL_PROMPT },
        ],
      }),
      signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
    });
  } catch {
    return { findings: null, warning: "Firecrawl did not answer in time." };
  }

  if (!response.ok) {
    const detail =
      response.status === 401 || response.status === 403
        ? "Firecrawl rejected the API key."
        : response.status === 402
          ? "Firecrawl account has no credits left."
          : `Firecrawl returned ${response.status}.`;
    return { findings: null, warning: detail };
  }

  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: { json?: Record<string, unknown> };
  } | null;
  const json = payload?.data?.json;
  if (!payload?.success || !json) {
    return { findings: null, warning: "Firecrawl returned no structured data." };
  }

  const asString = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;
  const keyPages = Array.isArray(json.keyPages)
    ? json.keyPages
        .map((row) => {
          const item = row as { url?: unknown; topic?: unknown };
          const pageUrl = asString(item.url);
          return pageUrl ? { url: pageUrl, topic: asString(item.topic) } : null;
        })
        .filter(
          (row): row is { url: string; topic: string | undefined } => row !== null,
        )
        .slice(0, MAX_KEY_PAGES_FROM_NAV)
    : [];

  return {
    findings: {
      businessOverview: asString(json.businessOverview),
      positioning: asString(json.positioning),
      writingPreferences: asString(json.writingPreferences),
      keyPages,
    },
    warning: null,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function autofillProjectContext(input: {
  projectId: string;
  domain: string | null;
}): Promise<ContextAutofillResult> {
  if (!input.domain) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This project has no domain to read. Set one in General settings first.",
    );
  }
  const origin = siteOrigin(input.domain);
  const warnings: string[] = [];

  const current = await ProjectContextService.getProjectContext(input.projectId);
  if (current.missingSections.length === 0 && current.keyPages.length > 0) {
    return {
      filled: [],
      left: [],
      source: "none",
      warnings: [
        "Every field already has content. Clear a field first if you want it re-read.",
      ],
    };
  }

  // Pass 1: the site itself. Free, and always attempted.
  const home = await crawlPage(`${origin}/`, 0, false);
  const siteReachable =
    home.statusCode >= 200 && home.statusCode < 400 && home.isHtml;
  if (!siteReachable) {
    warnings.push(
      `The homepage answered ${home.statusCode || "nothing"}; read what it could.`,
    );
  }
  const siteFindings: ContextFindings = {
    businessOverview:
      clip(home.metaDescription || home.ogDescription || "") || undefined,
    keyPages: siteReachable ? pickKeyPageCandidates(home.links, origin) : [],
  };

  // Pass 2: Firecrawl, for the prose the site pass cannot infer.
  let findings = siteFindings;
  let source: ContextAutofillResult["source"] =
    siteFindings.businessOverview || siteFindings.keyPages.length
      ? "site"
      : "none";

  const apiKey = await getOptionalEnvValue("FIRECRAWL_API_KEY");
  if (!apiKey) {
    warnings.push(
      "FIRECRAWL_API_KEY is not set, so only what the page states directly was used.",
    );
  } else if (siteReachable) {
    const fetched = await firecrawlFindings(apiKey, `${origin}/`);
    if (fetched.findings) {
      const fc = fetched.findings;
      findings = {
        businessOverview: fc.businessOverview ?? siteFindings.businessOverview,
        positioning: fc.positioning,
        writingPreferences: fc.writingPreferences,
        // The crawler's nav links are ground truth for what exists; Firecrawl's
        // picks fill in only when the crawler found nothing usable.
        keyPages: siteFindings.keyPages.length
          ? siteFindings.keyPages
          : fc.keyPages,
      };
      source = "firecrawl";
    } else if (fetched.warning) {
      warnings.push(fetched.warning);
    }
  }

  const plan = planContextFill(
    {
      missingSections: current.missingSections,
      keyPageCount: current.keyPages.length,
    },
    findings,
  );

  if (plan.updates.length > 0) {
    // Written as the person who pressed the button: it lands in their own
    // settings, editable like anything they typed.
    await ProjectContextService.applyContextUpdates(
      input.projectId,
      plan.updates,
      "user",
    );
  }

  return { filled: plan.filled, left: plan.left, source, warnings };
}
