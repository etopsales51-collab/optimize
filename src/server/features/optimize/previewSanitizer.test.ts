import { describe, expect, it } from "vitest";
import { sanitizePreviewHtml } from "./previewSanitizer";

/**
 * The preview renders agent-authored markup to the person about to click
 * Approve, so these are the attacks that matter, not a formatting suite.
 */
describe("sanitizePreviewHtml", () => {
  it("keeps the markup a content proposal actually needs", () => {
    const html =
      "<h2>New heading</h2><p>Some <strong>bold</strong> copy.</p><ul><li>One</li></ul>";
    expect(sanitizePreviewHtml(html)).toBe(html);
  });

  it("drops script elements and their contents", () => {
    const out = sanitizePreviewHtml(
      "<p>before</p><script>fetch('/api/steal')</script><p>after</p>",
    );
    expect(out).toBe("<p>before</p><p>after</p>");
    expect(out).not.toContain("fetch");
  });

  it("drops event handler attributes", () => {
    const out = sanitizePreviewHtml(
      `<div onclick="alert(1)" onmouseover="alert(2)">text</div>`,
    );
    expect(out).toBe("<div>text</div>");
  });

  it("strips javascript: urls, including ones hiding control characters", () => {
    expect(sanitizePreviewHtml(`<a href="javascript:alert(1)">x</a>`)).not.toContain(
      "javascript",
    );
    // Browsers ignore the tab when resolving the scheme; a prefix test alone
    // would let this through.
    expect(
      sanitizePreviewHtml(`<a href="java\tscript:alert(1)">x</a>`),
    ).not.toContain("script:");
  });

  it("strips data: urls on images", () => {
    const out = sanitizePreviewHtml(
      `<img src="data:text/html,<script>alert(1)</script>" alt="x">`,
    );
    expect(out).not.toContain("data:");
  });

  it("keeps safe links but neutralises the tab-nabbing vector", () => {
    const out = sanitizePreviewHtml(`<a href="https://example.com">go</a>`);
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it("drops style and class so agent markup cannot impersonate app UI", () => {
    const out = sanitizePreviewHtml(
      `<p style="position:fixed;inset:0" class="btn btn-primary">Approve</p>`,
    );
    expect(out).toBe("<p>Approve</p>");
  });

  it("escapes text so encoded markup cannot become live markup", () => {
    expect(sanitizePreviewHtml("<p>5 < 6 & 7 > 2</p>")).toBe(
      "<p>5 &lt; 6 &amp; 7 &gt; 2</p>",
    );
    // Entity-encoded input decodes to text, then is re-escaped — never a tag.
    expect(sanitizePreviewHtml("<p>&lt;script&gt;</p>")).toBe(
      "<p>&lt;script&gt;</p>",
    );
  });

  it("closes tags the agent left open so markup cannot leak into the page", () => {
    expect(sanitizePreviewHtml("<div><p>unclosed")).toBe(
      "<div><p>unclosed</p></div>",
    );
  });

  it("drops iframes, forms and inputs outright", () => {
    const out = sanitizePreviewHtml(
      `<iframe src="https://evil.test"></iframe><form action="/x"><input name="p"></form>`,
    );
    expect(out).toBe("");
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizePreviewHtml(null)).toBe("");
    expect(sanitizePreviewHtml(undefined)).toBe("");
    expect(sanitizePreviewHtml("")).toBe("");
  });
});
