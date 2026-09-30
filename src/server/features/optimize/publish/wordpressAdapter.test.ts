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

const TARGET =
  "https://www.etopme.ae/passport-scanner-vs-mobile-ocr-uae-visitor-check-in/";

const proposal: OptimizeProposal = {
  title: {
    before: "",
    after: "Passport Scanner vs Mobile OCR | UAE Visitor Check-in",
  },
  metaDescription: {
    before: "",
    after: "Compare passport scanners and mobile OCR.",
  },
  h1: { before: "", after: "Passport Scanner vs Mobile OCR" },
  sections: [
    { heading: "Speed", action: "add", after: "<p>Scanners are faster.</p>" },
  ],
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

function mockSite(options: {
  existing?: Record<string, unknown> | null;
  persistBody?: boolean;
  advanceModified?: boolean;
}) {
  const writes: Write[] = [];
  let current = options.existing ? { ...options.existing } : null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && typeof init.body !== "string") {
        return Response.json({
          id: 55,
          source_url: "https://www.etopme.ae/wp-content/uploads/scan.png",
        });
      }
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        writes.push({ url, body });
        if (url.includes("/wp/v2/posts") && !url.includes("/media")) {
          const creating = !/\/posts\/\d+/.test(url);
          const oldModified = String(
            current?.modified_gmt ?? "2026-09-23T08:00:00",
          );
          current = {
            ...(current ?? {}),
            id: current?.id ?? 900,
            link: current?.link ?? TARGET,
            status: body.status ?? current?.status ?? "publish",
            title: current?.title ?? { raw: String(body.title ?? "") },
            content:
              options.persistBody === false
                ? (current?.content ?? { raw: "<p>Old body</p>" })
                : { raw: String(body.content ?? current?.content ?? "") },
            modified_gmt:
              creating || options.advanceModified !== false
                ? "2026-09-30T12:00:00"
                : oldModified,
          };
        }
        return Response.json({ id: 900, link: TARGET });
      }
      if (url.includes("/wp/v2/posts?slug=")) {
        return Response.json(current ? [current] : []);
      }
      if (/\/wp\/v2\/posts\/\d+\?/.test(url))
        return Response.json(current ?? {});
      if (url.includes("/wp/v2/pages?slug=")) return Response.json([]);
      if (url.includes("/wp/v2/posts?per_page=1")) {
        return Response.json([
          { link: "https://www.etopme.ae/zkteco-biotime-free-software/" },
        ]);
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

    expect(result).toMatchObject({
      ok: true,
      mode: "create",
      target: { kind: "post" },
    });
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
          rank_math_title:
            "Passport Scanner vs Mobile OCR | UAE Visitor Check-in",
          rank_math_description: "Compare passport scanners and mobile OCR.",
          rank_math_focus_keyword: "passport scanner",
        },
      },
    });
  });

  it("uploads the images, sets the hero as featured image and mounts the rest in the body", async () => {
    const writes = mockSite({ existing: null });
    const result = await publish(
      credentials,
      TARGET,
      {
        ...proposal,
        images: [
          {
            slotId: "hero",
            role: "hero",
            alt: "Hero",
            assetId: "8f7c1a52-5b0e-4d7e-9a61-2f4a0e1c9b11",
          },
          {
            slotId: "scan-ui",
            role: "inline",
            alt: "Scan",
            assetId: "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9",
            afterSection: 0,
          },
          {
            slotId: "export",
            role: "inline",
            alt: "Export",
            prompt: "Export to sheet",
          },
        ],
      },
      {
        allowCreate: true,
        loadImage: async () => ({
          bytes: new ArrayBuffer(8),
          contentType: "image/png",
        }),
      },
    );

    expect(result.ok).toBe(true);
    const post = writes.find((write) => write.url.endsWith("/wp/v2/posts"));
    expect(post?.body.featured_media).toBe(55);
    expect(String(post?.body.content)).toContain("wp-content/uploads/scan.png");
    // The empty slot has nothing to publish and leaves no placeholder behind.
    expect(String(post?.body.content)).not.toContain("Export to sheet");
  });

  it("never rewrites an existing post's title or body, only its SEO fields and draft status", async () => {
    const writes = mockSite({
      existing: {
        id: 42,
        status: "draft",
        link: "https://www.etopme.ae/?p=42",
        title: { raw: "Kept" },
      },
    });
    const result = await publish(credentials, TARGET, proposal, {
      allowCreate: true,
    });

    expect(result).toMatchObject({ ok: true, mode: "update" });
    expect(writes.map((write) => write.body)).toEqual([
      { status: "publish" },
      expect.objectContaining({ objectID: 42 }),
    ]);
  });

  it("writes and verifies the body for a content refresh", async () => {
    const writes = mockSite({
      existing: {
        id: 42,
        status: "publish",
        link: TARGET,
        title: { raw: "Kept" },
        modified_gmt: "2026-09-23T08:00:00",
        content: { raw: "<p>Old body</p>" },
      },
    });

    const result = await publish(credentials, TARGET, proposal, {
      allowCreate: false,
      updateContent: true,
    });

    expect(result).toMatchObject({ ok: true, mode: "update" });
    const update = writes.find((write) =>
      write.url.includes("/wp/v2/posts/42"),
    );
    expect(update?.body.content).toContain("<h2>Speed</h2>");
    expect(update?.body.content).toContain("<p>Scanners are faster.</p>");
  });

  it("fails a content refresh when WordPress does not save the new body", async () => {
    mockSite({
      existing: {
        id: 42,
        status: "publish",
        link: TARGET,
        title: { raw: "Kept" },
        modified_gmt: "2026-09-23T08:00:00",
        content: { raw: "<p>Old body</p>" },
      },
      persistBody: false,
    });

    const result = await publish(credentials, TARGET, proposal, {
      allowCreate: false,
      updateContent: true,
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok)
      expect(result.reason).toContain("does not contain the new body");
  });

  it("fails a content refresh when the modified time does not advance", async () => {
    mockSite({
      existing: {
        id: 42,
        status: "publish",
        link: TARGET,
        title: { raw: "Kept" },
        modified_gmt: "2026-09-23T08:00:00",
        content: { raw: "<p>Old body</p>" },
      },
      advanceModified: false,
    });

    const result = await publish(credentials, TARGET, proposal, {
      allowCreate: false,
      updateContent: true,
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok)
      expect(result.reason).toContain("modified time did not advance");
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
    expect(
      matchPostCategory(decoded, "Passport Scanner vs Mobile OCR")?.id,
    ).toBe(528);
    expect(matchPostCategory(decoded, "Mail management system")).toBeNull();
  });
});
