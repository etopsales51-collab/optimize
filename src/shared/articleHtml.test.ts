import { describe, expect, it } from "vitest";
import { buildArticleBodyHtml } from "./articleHtml";
import type { ArticleImage, OptimizeProposal } from "./optimize";

const sections: OptimizeProposal["sections"] = [
  { heading: "Speed", action: "add", after: "<p>One</p>" },
  { heading: "Accuracy", action: "add", after: "<p>Two</p>" },
];

const image = (overrides: Partial<ArticleImage>): ArticleImage => ({
  slotId: "scan-ui",
  role: "inline",
  alt: "",
  ...overrides,
});

describe("buildArticleBodyHtml", () => {
  it("mounts an inline image after the section it names, and the hero nowhere in the body", () => {
    const html = buildArticleBodyHtml(
      {
        sections,
        images: [
          image({ slotId: "hero", role: "hero", url: "https://img.test/hero.png" }),
          image({ afterSection: 0, url: "https://img.test/scan.png", alt: "Scan screen" }),
        ],
      },
      { imageSource: (entry) => entry.url ?? null, placeholders: false },
    );

    expect(html.indexOf("scan.png")).toBeGreaterThan(html.indexOf("<p>One</p>"));
    expect(html.indexOf("scan.png")).toBeLessThan(html.indexOf("Accuracy"));
    expect(html).not.toContain("hero.png");
  });

  it("escapes agent-written alt text and captions", () => {
    const html = buildArticleBodyHtml(
      {
        sections,
        images: [image({ url: "https://img.test/a.png", alt: '"><script>x</script>', caption: "<b>hi</b>" })],
      },
      { imageSource: (entry) => entry.url ?? null, placeholders: false },
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>hi</b>");
  });

  it("shows an empty slot in the preview but leaves it out of the published post", () => {
    const proposal = { sections, images: [image({ prompt: "Passport scan UI" })] };
    const noSource = () => null;

    expect(buildArticleBodyHtml(proposal, { imageSource: noSource, placeholders: true })).toContain(
      "Passport scan UI",
    );
    expect(buildArticleBodyHtml(proposal, { imageSource: noSource, placeholders: false })).not.toContain(
      "figure",
    );
  });
});
