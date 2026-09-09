import { describe, expect, it } from "vitest";
import { createRecommendationSchema } from "@/shared/optimize";

/**
 * A real recommendation drafted by an external agent (Grok / "SEO Genius")
 * during the first connectivity test on 2026-09-09, verbatim.
 *
 * This is the contract test for the write path: the promise made to the agent
 * was that the JSON it drafts today posts unchanged once
 * create_optimize_recommendation exists. If this fixture ever stops parsing,
 * the schema changed under a live integration and the agent prompt is wrong.
 */
const grokDraft = {
  type: "content_refresh",
  priority: "p1",
  targetUrl:
    "https://wacomme.ae/digital-signature-software/wacom-sign-pro-pdf-app/",
  primaryQuery: "wacom sign pro pdf",
  secondaryQueries: [
    "sign pro pdf",
    "wacom sign pro",
    "sign pro pdf download",
    "sign pdf with wacom tablet",
    "wacom signature software",
  ],
  evidence: [
    {
      source: "gsc_striking_distance",
      label: "wacom sign pro pdf — 12 impressions, avg pos 17.5 (last 28d)",
      url: "https://wacomme.ae/digital-signature-software/wacom-sign-pro-pdf-app/",
      metric: "impressions",
      value: 12,
    },
    {
      source: "site_audit",
      label: "Audit page 200 — title present in crawl",
      refId: "c6cd937c-7e18-4c0d-b1aa-aa138e99061d",
    },
    {
      source: "competitor",
      label: "SERP #1 Wacom global product page owns the head term",
      url: "https://www.wacom.com/en-us/enterprise/signature-solutions/products/sign-pro-pdf",
    },
  ],
  proposal: {
    title: {
      before: "Wacom sign pro PDF App | Sign PDFs by Pen, UAE",
      after: "Wacom sign pro PDF UAE | Free App to Sign PDFs with Pen",
    },
    // The live page has no meta description (the audit flags it), so
    // `before` is legitimately empty — the schema must accept that.
    metaDescription: {
      before: "",
      after:
        "Download Wacom sign pro PDF in the UAE. Sign and fill PDFs by hand on Windows with a Wacom signature pad. Standard free; Premium available. Local eTOP support.",
    },
    h1: { before: "Overview", after: "Wacom sign pro PDF for UAE businesses" },
    sections: [
      {
        heading: "Download & setup (Windows)",
        action: "add",
        after:
          "<p>Get <strong>sign pro PDF Standard</strong> free, or Premium if you need enhanced features.</p><ul><li>Windows desktop app</li></ul>",
      },
      {
        heading: "App vs API vs Ink SDK",
        action: "rewrite",
        before: "Long comparison table already on page",
        after:
          '<p>Use the <strong>app</strong> for ad-hoc signing; use the <a href="https://wacomme.ae/digital-signature-software/wacom-sign-pro-pdf-api/">sign pro PDF API</a> when CRM/ERP must drive signing.</p>',
      },
    ],
    internalLinks: [
      {
        anchor: "sign pro PDF API",
        toUrl:
          "https://wacomme.ae/digital-signature-software/wacom-sign-pro-pdf-api/",
        action: "add",
      },
    ],
    notes:
      "GSC shows demand for the brand software terms but weak positions while Wacom.com and a regional reseller own the SERP.",
  },
  cannibalizationCheck: {
    status: "clear",
    method: "title_h1_overlap",
    overlappingUrls: [],
    notes:
      "Compared against audit titles/paths: /digital-signature-software/ (hub), /wacom-sign-pro-pdf-api/ (integration). Distinct intents — do not merge.",
  },
  pageSnapshot: {
    url: "https://wacomme.ae/digital-signature-software/wacom-sign-pro-pdf-app/",
    fetchedAt: "2026-09-09T11:30:00.000Z",
    title: "Wacom sign pro PDF App | Sign PDFs by Pen, UAE",
    metaDescription: "",
    h1: "Overview",
    wordCount: 950,
  },
};

describe("agent-drafted recommendation payload", () => {
  it("parses Grok's first real draft without modification", () => {
    const result = createRecommendationSchema.safeParse(grokDraft);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("defaults to pending_approval so it lands in the staff review queue", () => {
    expect(createRecommendationSchema.parse(grokDraft).status).toBe(
      "pending_approval",
    );
  });

  it("carries no merge plan because it is not a merge_pages proposal", () => {
    expect(createRecommendationSchema.parse(grokDraft).merge).toBeUndefined();
  });
});
