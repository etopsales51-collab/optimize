import { describe, expect, it } from "vitest";
import { sanitizeProposalCopy } from "./copySanitizer";
import type { OptimizeProposal } from "@/shared/optimize";

/**
 * Regressions from the ViRDi AC-5100 publish, where agent working notes reached
 * a live product page. Each case here is something a customer actually saw.
 */

function proposalWith(overrides: Partial<OptimizeProposal>): OptimizeProposal {
  return {
    sections: [],
    internalLinks: [],
    attachments: [],
    notes: "",
    ...overrides,
  };
}

function sectionsOf(proposal: OptimizeProposal, html: string) {
  return sanitizeProposalCopy(
    proposalWith({
      ...proposal,
      sections: [{ heading: "Specifications", action: "add", after: html }],
    }),
  );
}

describe("spec cells hold bare values", () => {
  it("drops the parenthetical essay and keeps the value", () => {
    const { proposal, removals } = sectionsOf(
      proposalWith({}),
      "<table><tr><td>X (portfolio row; marketing still says Outdoor — verify before publish)</td></tr></table>",
    );

    expect(proposal.sections[0].after).toContain("<td>X</td>");
    expect(removals).toHaveLength(1);
    expect(removals[0].field).toBe("sections[0].after");
  });

  it("drops a long aside in a cell even with no marker in it", () => {
    const { proposal } = sectionsOf(
      proposalWith({}),
      "<table><tr><td>IP65 (this rating was taken from the distributor sheet rather than the manufacturer)</td></tr></table>",
    );
    expect(proposal.sections[0].after).toContain("<td>IP65</td>");
  });

  it("keeps a short, useful unit in a cell", () => {
    const { proposal, removals } = sectionsOf(
      proposalWith({}),
      "<table><tr><td>20,000 (1:N)</td><td>IP65 (dust-tight)</td></tr></table>",
    );
    expect(proposal.sections[0].after).toContain("20,000 (1:N)");
    expect(proposal.sections[0].after).toContain("IP65 (dust-tight)");
    expect(removals).toEqual([]);
  });
});

describe("process talk in body copy", () => {
  it("deletes a footer that is entirely agent notes", () => {
    const { proposal } = sectionsOf(
      proposalWith({}),
      "<p>Rugged outdoor terminal.</p><p>Verbatim nested table from the manufacturer. No images in this brief.</p>",
    );

    expect(proposal.sections[0].after).toBe("<p>Rugged outdoor terminal.</p>");
  });

  it("keeps the sentence beside the one it removes", () => {
    const { proposal } = sectionsOf(
      proposalWith({}),
      "<p>IK09 vandal-proof housing. Flag for Walid: confirm the IP rating.</p>",
    );

    expect(proposal.sections[0].after).toBe("<p>IK09 vandal-proof housing.</p>");
  });

  it("does not eat 'verify' where it is what the product does", () => {
    const { proposal, removals } = sectionsOf(
      proposalWith({}),
      "<p>Verify your identity in under a second.</p>",
    );
    expect(proposal.sections[0].after).toContain("Verify your identity");
    expect(removals).toEqual([]);
  });
});

describe("plain fields", () => {
  it("strips process notes and markup from the SEO title and meta", () => {
    const { proposal } = sanitizeProposalCopy(
      proposalWith({
        title: {
          before: "",
          after: "ViRDi AC-5100 UAE (verify before publish)",
        },
        metaDescription: {
          before: "",
          after: "<strong>Buy the AC-5100</strong> in Dubai. TODO: pricing.",
        },
      }),
    );

    expect(proposal.title?.after).toBe("ViRDi AC-5100 UAE");
    expect(proposal.metaDescription?.after).toBe("Buy the AC-5100 in Dubai.");
  });

  it("reports the field each removal came from", () => {
    const { removals } = sanitizeProposalCopy(
      proposalWith({
        h1: { before: "", after: "AC-5100 (out of scope for this round)" },
      }),
    );
    expect(removals).toMatchObject([{ field: "h1" }]);
  });
});

describe("staff-only fields", () => {
  it("leaves notes exactly as written — that is where verification belongs", () => {
    const notes =
      "Portfolio row says Outdoor; marketing says Indoor. Flag for Walid to verify before publish.";
    const { proposal, removals } = sanitizeProposalCopy(proposalWith({ notes }));

    expect(proposal.notes).toBe(notes);
    expect(removals).toEqual([]);
  });
});

describe("publishable markup is sanitized, not just de-noised", () => {
  it("removes script from a section, which is rendered to the approver", () => {
    // sections[].after reaches dangerouslySetInnerHTML in the review UI, so an
    // agent's markup runs in the session of the person about to click Approve.
    const { proposal } = sectionsOf(
      proposalWith({}),
      '<p>Specs</p><script>fetch("https://evil.test")</script><img src=x onerror="alert(1)">',
    );

    const html = proposal.sections[0].after ?? "";
    expect(html).not.toContain("script");
    expect(html).not.toContain("onerror");
    expect(html).toContain("<p>Specs</p>");
  });
});
