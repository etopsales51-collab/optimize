import { afterEach, describe, expect, it, vi } from "vitest";
import { matchPostCategory, publish } from "./wordpressAdapter";
import type { OptimizeProposal } from "@/shared/optimize";

/**
 * The fixtures mirror etopme.ae: posts live at the site root, and category 1
 * was renamed from Uncategorized to "Turnstile & Speed Gates", so a post
 * filed under no category lands somewhere wrong.
 */

const credentials = {
  baseUrl: "https://www.etopme.ae",
  username: "deepinsights-bot",
  appPassword: "xxxx xxxx",
};

const TARGET = "https://www.etopme.ae/passport-scanner-vs-mobile-ocr-uae-visitor-check-in/";

const proposal: OptimizeProposal = {
  title: { before: "", after: "Passport Scanner vs Mobile OCR | UAE Visitor Check-in" },
  metaDescription: { before: "", after: "Compare passport scanners and mobile OCR." },
  h1: { before: "", after: "Passport Scanner vs Mobile OCR" },
  sections: [{ heading: "Speed", action: "add", after: "<p>Scanners are faster.</p>" }],
  internalLinks: [],
  attachments: [],
  notes: "",
};

const categories = [
  { id: 1, name: "Turnstile &amp; Speed Gates", count: 64 },
  { id: 528, name: "Passport Scanners", count: 2 },
  { id: 529, name: "Signature Pads", count: 14 },
];

type Write = { url: string; body: Record<string, unknown> };

function mockSite(options: { existing?: Record<string, unknown> | null }) {
  const writes: Write[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        writes.push({ url, body });
        return Response.json({ id: 900, link: TARGET });
      }
      if (url.includes("/wp/v2/posts?slug=")) {
        return Response.json(options.existing ? [options.existing] : []);
      }
      if (url.includes("/wp/v2/pages?slug=")) return Response.json([]);
      if (url.includes("/wp/v2/posts?per_page=1")) {
        return Response.json([{ link: "https://www.etopme.ae/zkteco-biotime-free-software/" }]);
      }
      if (url.includes("/wp/v2/categories")) return Response.json(categories);
      return new Response("<title>Old title</title>", { status: 200 });
    }),
  );
  return writes;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wordpress publish", () => {
  it("creates a brief at a root URL as a published post, filed and with Rank Math fields", async () => {
    const writes = mockSite({ existing: null });
    const result = await publish(credentials, TARGET, proposal, {
      allowCreate: true,
      focusKeyword: "passport scanner",
    });

    expect(result).toMatchObject({ ok: true, mode: "create", target: { kind: "post" } });
    expect(writes[0].url).toContain("/wp/v2/posts");
    expect(writes[0].body).toMatchObject({
      title: "Passport Scanner vs Mobile OCR",
      slug: "passport-scanner-vs-mobile-ocr-uae-visitor-check-in",
      status: "publish",
      categories: [528],
    });
    expect(writes[1]).toEqual({
      url: "https://www.etopme.ae/wp-json/rankmath/v1/updateMeta",
      body: {
        objectType: "post",
        objectID: 900,
        meta: {
          rank_math_title: "Passport Scanner vs Mobile OCR | UAE Visitor Check-in",
          rank_math_description: "Compare passport scanners and mobile OCR.",
          rank_math_focus_keyword: "passport scanner",
        },
      },
    });
  });

  it("never rewrites an existing post's title or body, only its SEO fields and draft status", async () => {
    const writes = mockSite({
      existing: { id: 42, status: "draft", link: "https://www.etopme.ae/?p=42", title: { raw: "Kept" } },
    });
    const result = await publish(credentials, TARGET, proposal, { allowCreate: true });

    expect(result).toMatchObject({ ok: true, mode: "update" });
    expect(writes.map((write) => write.body)).toEqual([
      { status: "publish" },
      expect.objectContaining({ objectID: 42 }),
    ]);
  });

  it("refuses to create a nested URL whose parent page would be a guess", async () => {
    const writes = mockSite({ existing: null });
    const result = await publish(
      credentials,
      "https://www.etopme.ae/solutions/visitor-check-in/",
      proposal,
      { allowCreate: true },
    );

    expect(result.ok).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("matchPostCategory", () => {
  it("files under the category the brief is about, or none rather than a weak guess", () => {
    const decoded = categories.map((category) => ({
      ...category,
      name: category.name.replace("&amp;", "&"),
    }));
    expect(matchPostCategory(decoded, "Passport Scanner vs Mobile OCR")?.id).toBe(528);
    expect(matchPostCategory(decoded, "Mail management system")).toBeNull();
  });
});
