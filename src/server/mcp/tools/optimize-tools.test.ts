import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeToolContext } from "./tool-test-support";

/**
 * What these tests defend: an external agent holding an API key cannot get a
 * change onto a live site, and cannot create a competing page when one already
 * covers the intent. Those are the two promises the whole Optimize loop rests
 * on, so they are tested at the tool boundary — the surface Grok actually hits.
 */

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  createRecommendation: vi.fn(),
  get: vi.fn(),
  addComment: vi.fn(),
  listCrawlInventoryForProject: vi.fn(),
}));

vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

// project-auth imports the repository for user-scoped (API key) credentials;
// unused here (pinned context) but keeps the db out of the module graph.
vi.mock("@/server/auth/repositories/AuthRepository", () => ({
  AuthRepository: { getMembership: vi.fn() },
}));

vi.mock("@/server/features/optimize/services/OptimizeService", () => ({
  OptimizeService: {
    createRecommendation: mocks.createRecommendation,
    get: mocks.get,
    addComment: mocks.addComment,
  },
}));

vi.mock("@/server/features/optimize/repositories/OptimizeRepository", () => ({
  OptimizeRepository: {
    listCrawlInventoryForProject: mocks.listCrawlInventoryForProject,
  },
}));

const {
  createOptimizeRecommendationTool,
  analyzeIntentOverlapTool,
} = await import("./optimize-tools");

const PROJECT = {
  id: "proj_1",
  name: "WACOM",
  domain: "wacomme.ae",
  locationCode: 2784,
  languageCode: "en",
};

const clearCheck = {
  status: "clear" as const,
  method: "title_h1_overlap" as const,
  overlappingUrls: [],
  notes: "",
};

const baseArgs = {
  projectId: "proj_1",
  type: "content_refresh" as const,
  targetUrl: "https://wacomme.ae/pens",
  proposal: { sections: [], internalLinks: [], notes: "" },
  cannibalizationCheck: clearCheck,
};

beforeEach(() => {
  mocks.getProjectForOrganization.mockResolvedValue(PROJECT);
  mocks.createRecommendation.mockResolvedValue("rec_1");
  mocks.get.mockResolvedValue({
    id: "rec_1",
    status: "pending_approval",
    type: "content_refresh",
    priority: "p2",
    targetUrl: "https://wacomme.ae/pens",
  });
});

describe("create_optimize_recommendation", () => {
  it("posts for review — never approved, so nothing can reach the live site", async () => {
    const result = await createOptimizeRecommendationTool.handler(
      baseArgs,
      makeToolContext(),
    );

    expect(result.structuredContent?.status).toBe("pending_approval");
    // The tool has no way to express "approved": the service is called with
    // the agent's payload, and approval is a separate, staff-only path.
    const [call] = mocks.createRecommendation.mock.calls;
    expect(call[0].payload.status).toBeUndefined();
    expect(JSON.stringify(call[0])).not.toContain("approved");
  });

  it("refuses a project outside the caller's organization", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);
    await expect(
      createOptimizeRecommendationTool.handler(
        { ...baseArgs, projectId: "someone_elses_project" },
        makeToolContext(),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.createRecommendation).not.toHaveBeenCalled();
  });

  it("attributes the proposal to the agent label staff will see", async () => {
    await createOptimizeRecommendationTool.handler(
      { ...baseArgs, agentId: "seo-genius", agentLabel: "SEO Genius" },
      makeToolContext(),
    );
    expect(mocks.createRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { type: "agent", id: "seo-genius", label: "SEO Genius" },
      }),
    );
  });

  it("falls back to the API key's account when no agent id is given", async () => {
    await createOptimizeRecommendationTool.handler(baseArgs, makeToolContext());
    expect(mocks.createRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ id: "alice@example.com" }),
      }),
    );
  });

  it("stamps the project's domain so the row is readable later", async () => {
    await createOptimizeRecommendationTool.handler(baseArgs, makeToolContext());
    expect(mocks.createRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "wacomme.ae" }),
    );
  });
});

describe("analyze_intent_overlap", () => {
  const pages = [
    {
      url: "https://wacomme.ae/mail-management-system/",
      statusCode: 200,
      redirectUrl: null,
      fetchClass: "html",
      title: "Mail Management System | UAE",
      ogTitle: null,
      metaDescription: null,
      inSitemap: true,
      internalLinkCount: 12,
      wordCount: 800,
    },
    {
      url: "https://wacomme.ae/mail-management-solution/",
      statusCode: 200,
      redirectUrl: null,
      fetchClass: "html",
      title: "Mail Management Solution for Offices",
      ogTitle: null,
      metaDescription: null,
      inSitemap: true,
      internalLinkCount: 3,
      wordCount: 600,
    },
    {
      url: "https://wacomme.ae/signature-pad/",
      statusCode: 200,
      redirectUrl: null,
      fetchClass: "html",
      title: "Wacom Signature Pads",
      ogTitle: null,
      metaDescription: null,
      inSitemap: true,
      internalLinkCount: 20,
      wordCount: 900,
    },
  ];

  beforeEach(() => {
    mocks.listCrawlInventoryForProject.mockResolvedValue({
      auditId: "audit_1",
      startedAt: "2026-09-09T00:00:00.000Z",
      pages,
    });
  });

  it("treats 'system' and 'solution' as one intent and recommends a merge", async () => {
    const result = await analyzeIntentOverlapTool.handler(
      { projectId: "proj_1", query: "mail management system" },
      makeToolContext(),
    );

    expect(result.structuredContent?.recommendation).toBe("merge_pages");
    // The better-linked page survives; the weaker one is merged into it.
    expect(result.structuredContent?.keepUrl).toBe(
      "https://wacomme.ae/mail-management-system/",
    );
    expect(result.structuredContent?.mergeFromUrls).toEqual([
      "https://wacomme.ae/mail-management-solution/",
    ]);
    expect(result.structuredContent?.cannibalizationCheck.status).toBe(
      "merge_recommended",
    );
  });

  it("allows a genuinely new intent", async () => {
    const result = await analyzeIntentOverlapTool.handler(
      { projectId: "proj_1", query: "biometric attendance terminal" },
      makeToolContext(),
    );
    expect(result.structuredContent?.recommendation).toBe("new_page_allowed");
    expect(result.structuredContent?.cannibalizationCheck.status).toBe("clear");
  });

  it("points at the existing page when exactly one already owns the intent", async () => {
    const result = await analyzeIntentOverlapTool.handler(
      { projectId: "proj_1", query: "signature pad" },
      makeToolContext(),
    );
    expect(result.structuredContent?.recommendation).toBe("optimize_existing");
    expect(result.structuredContent?.keepUrl).toBe(
      "https://wacomme.ae/signature-pad/",
    );
  });

  it("says so plainly when there is no audit to compare against", async () => {
    mocks.listCrawlInventoryForProject.mockResolvedValue({
      auditId: null,
      startedAt: null,
      pages: [],
    });
    const result = await analyzeIntentOverlapTool.handler(
      { projectId: "proj_1", query: "anything" },
      makeToolContext(),
    );
    expect(result.structuredContent?.pagesScanned).toBe(0);
    expect(result.content[0].text).toContain("No completed site audit");
  });
});
