import { describe, expect, it } from "vitest";
import {
  canApprove,
  canRetryPublish,
  canTransition,
  isExecutable,
  newPageBriefAllowed,
  createRecommendationSchema,
  OPTIMIZE_STATUSES,
  type CannibalizationCheck,
} from "@/shared/optimize";

/**
 * The two product invariants, tested at the rule level so they hold regardless
 * of which caller (MCP tool, webhook, UI) reaches them.
 */

const clear: CannibalizationCheck = {
  status: "clear",
  method: "query_overlap",
  overlappingUrls: [],
  notes: "",
};

describe("anti-cannibalization (Part H)", () => {
  it("allows a new page only when the scan is clear and finds nothing", () => {
    expect(newPageBriefAllowed(clear)).toBe(true);
  });

  it("blocks a new page when overlapping URLs were found", () => {
    expect(
      newPageBriefAllowed({
        ...clear,
        status: "overlap_found",
        overlappingUrls: [{ url: "https://x.test/mail-management-system" }],
      }),
    ).toBe(false);
  });

  it("blocks a new page when a merge was recommended", () => {
    expect(
      newPageBriefAllowed({ ...clear, status: "merge_recommended" }),
    ).toBe(false);
  });

  it("blocks a 'clear' verdict that still lists overlaps", () => {
    // An agent could set status clear while reporting overlaps; the URLs win.
    expect(
      newPageBriefAllowed({
        ...clear,
        overlappingUrls: [{ url: "https://x.test/mail-management-solution" }],
      }),
    ).toBe(false);
  });
});

describe("approval gate", () => {
  it("only allows approval from pending_approval", () => {
    for (const status of OPTIMIZE_STATUSES) {
      expect(canApprove(status)).toBe(status === "pending_approval");
    }
  });

  it("treats only approved as executable, so nothing reaches WordPress early", () => {
    for (const status of OPTIMIZE_STATUSES) {
      expect(isExecutable(status)).toBe(status === "approved");
    }
  });

  it("cannot jump straight from a fresh proposal to running", () => {
    expect(canTransition("pending_approval", "running")).toBe(false);
    expect(canTransition("draft", "approved")).toBe(false);
  });

  it("routes changes_requested back through review, never straight to approved", () => {
    expect(canTransition("changes_requested", "pending_approval")).toBe(true);
    expect(canTransition("changes_requested", "approved")).toBe(false);
  });

  it("treats succeeded, cancelled and dismissed as terminal", () => {
    for (const status of ["succeeded", "cancelled", "dismissed"] as const) {
      expect(canTransition(status, "pending_approval")).toBe(false);
      expect(canTransition(status, "approved")).toBe(false);
    }
  });

  it("lets a failed publish be retried, but never back into review", () => {
    // The failure is operational — a bad credential, an unreachable site —
    // while the approval of the content still stands. So it returns to
    // `approved`, where publishing re-runs every gate...
    expect(canRetryPublish("failed")).toBe(true);
    expect(canTransition("failed", "approved")).toBe(true);
    // ...and never to pending_approval, which would let a failed item sit in
    // the review queue as though it had not been approved.
    expect(canTransition("failed", "pending_approval")).toBe(false);
  });

  it("offers retry only for a failed publish", () => {
    for (const status of OPTIMIZE_STATUSES) {
      expect(canRetryPublish(status)).toBe(status === "failed");
    }
  });
});

describe("agent payload validation", () => {
  const base = {
    type: "content_refresh" as const,
    targetUrl: "https://wacomme.ae/smartpads",
    proposal: { sections: [], internalLinks: [], notes: "" },
    cannibalizationCheck: clear,
  };

  it("defaults a submitted recommendation to pending_approval", () => {
    expect(createRecommendationSchema.parse(base).status).toBe(
      "pending_approval",
    );
  });

  it("rejects a non-URL target", () => {
    expect(() =>
      createRecommendationSchema.parse({ ...base, targetUrl: "not-a-url" }),
    ).toThrow();
  });

  it("requires a cannibalization check on every create", () => {
    const { cannibalizationCheck: _omitted, ...withoutCheck } = base;
    expect(() => createRecommendationSchema.parse(withoutCheck)).toThrow();
  });

  it("rejects a status an agent is not allowed to set directly", () => {
    expect(() =>
      createRecommendationSchema.parse({ ...base, status: "approved" }),
    ).toThrow();
  });
});
