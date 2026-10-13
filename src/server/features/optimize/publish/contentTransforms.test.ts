import { describe, expect, it } from "vitest";

import { applyInternalLinks, applySectionEdits } from "./contentTransforms";

describe("publisher content transforms", () => {
  it("adds an internal link once and keeps headings and existing links untouched", () => {
    const input =
      "<!-- wp:paragraph --><p>Read our door controllers guide.</p><!-- /wp:paragraph --><h2>Door controllers</h2>";
    const first = applyInternalLinks(
      input,
      [
        {
          anchor: "door controllers",
          toUrl: "https://example.com/controllers/",
          action: "add",
        },
      ],
      "https://example.com",
    );
    expect(first.html).toContain(
      '<a href="https://example.com/controllers/">door controllers</a>',
    );
    expect(first.html).toContain("<h2>Door controllers</h2>");
    const second = applyInternalLinks(
      first.html,
      [
        {
          anchor: "door controllers",
          toUrl: "https://example.com/controllers/",
          action: "add",
        },
      ],
      "https://example.com",
    );
    expect(second.html).toBe(first.html);
    expect(second.results[0]).toMatchObject({
      action: "skipped",
      reason: "already linked",
    });
  });

  it("cleans attributes only from internal links", () => {
    const result = applyInternalLinks(
      '<p><a href="/contact/" rel="nofollow noopener" target="_blank">Contact</a> <a href="https://other.test" rel="noopener" target="_blank">Other</a></p>',
      [],
      "https://example.com",
    );
    expect(result.html).toContain(
      '<a href="/contact/" rel="noopener">Contact</a>',
    );
    expect(result.html).toContain(
      '<a href="https://other.test" rel="noopener" target="_blank">Other</a>',
    );
  });

  it("rewrites a matched section without replacing surrounding block markup", () => {
    const input =
      "<!-- wp:heading --><h2>Features</h2><!-- /wp:heading --><p>Old</p><h2>FAQ</h2><p>Keep</p>";
    const output = applySectionEdits(
      input,
      [
        {
          heading: "Features",
          action: "rewrite",
          before: "Old",
          after: "<p>New</p>",
        },
      ],
      true,
    );
    expect(output).toContain("<!-- wp:heading -->");
    expect(output).toContain("<p>New</p>");
    expect(output).toContain("<h2>FAQ</h2><p>Keep</p>");
  });
});
