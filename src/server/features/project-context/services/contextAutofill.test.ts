import { describe, expect, it } from "vitest";
import { pickKeyPageCandidates, planContextFill } from "./contextAutofillPlan";
import type { PageLink } from "@/server/lib/audit/types";

const ORIGIN = "https://ubio.ae";

function link(targetUrl: string, anchor: string | null = null, isInternal = true): PageLink {
  return { targetUrl, anchor, isInternal, isNofollow: false };
}

describe("pickKeyPageCandidates", () => {
  it("keeps section pages and drops the store plumbing", () => {
    const picked = pickKeyPageCandidates(
      [
        link("/product-category/nitgen-biometric-devices/", "Nitgen"),
        link("/about-us/", "About"),
        link("/cart/", "Cart"),
        link("/my-account/", "Account"),
        link("/privacy-policy/", "Privacy"),
        link("https://facebook.com/ubio", "Facebook", false),
      ],
      ORIGIN,
    );

    expect(picked.map((page) => page.url)).toEqual([
      `${ORIGIN}/product-category/nitgen-biometric-devices`,
      `${ORIGIN}/about-us`,
    ]);
    expect(picked[0].topic).toBe("Nitgen");
  });

  it("treats a page reached twice as one candidate", () => {
    const picked = pickKeyPageCandidates(
      [link("/shop/", "Shop"), link("/shop/?orderby=price", "Sort"), link("/Shop", "Shop")],
      ORIGIN,
    );
    expect(picked).toHaveLength(1);
  });

  it("stops at eight, so a mega-menu does not become the shortlist", () => {
    const links = Array.from({ length: 20 }, (_, i) => link(`/section-${i}/`, `S${i}`));
    expect(pickKeyPageCandidates(links, ORIGIN)).toHaveLength(8);
  });
});

describe("planContextFill", () => {
  const findings = {
    businessOverview: "Biometric access control for UAE businesses.",
    positioning: "Authorised Nitgen and ViRDi distributor.",
    writingPreferences: "Plain, technical, third person.",
    keyPages: [{ url: `${ORIGIN}/shop`, topic: "Shop" }],
  };

  it("writes only the sections that are empty", () => {
    const plan = planContextFill(
      { missingSections: ["positioning"], keyPageCount: 3 },
      findings,
    );

    expect(plan.updates).toEqual([
      { section: "positioning", content: findings.positioning },
    ]);
    expect(plan.filled).toEqual(["positioning"]);
  });

  it("never guesses the current goal, and says so", () => {
    const plan = planContextFill(
      { missingSections: ["current_goal", "business_overview"], keyPageCount: 1 },
      findings,
    );

    expect(plan.updates).toEqual([
      { section: "business_overview", content: findings.businessOverview },
    ]);
    expect(plan.left).toEqual(["current_goal"]);
  });

  it("adds key pages only when the list is empty", () => {
    const empty = planContextFill({ missingSections: [], keyPageCount: 0 }, findings);
    expect(empty.updates).toEqual([
      { addKeyPages: [{ url: `${ORIGIN}/shop`, role: "other", topic: "Shop" }] },
    ]);
    expect(empty.filled).toEqual(["key_pages"]);

    const populated = planContextFill({ missingSections: [], keyPageCount: 2 }, findings);
    expect(populated.updates).toEqual([]);
  });

  it("reports a field it could not fill instead of writing a blank", () => {
    const plan = planContextFill(
      { missingSections: ["writing_preferences"], keyPageCount: 0 },
      { keyPages: [] },
    );
    expect(plan.updates).toEqual([]);
    expect(plan.left).toEqual(["writing_preferences", "key_pages"]);
  });
});
