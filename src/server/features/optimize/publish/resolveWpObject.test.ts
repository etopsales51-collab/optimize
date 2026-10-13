import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveWpObject } from "./resolveWpObject";

const credentials = {
  baseUrl: "https://example.com",
  username: "editor",
  appPassword: "secret",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("resolveWpObject", () => {
  it("resolves a nested product category from its REST alternate link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "https://example.com/product-category/parent/child/") {
          return new Response(
            '<link rel="alternate" type="application/json" href="https://example.com/wp-json/wp/v2/product_cat/25">',
            {
              headers: { "Content-Type": "text/html" },
            },
          );
        }
        if (url.includes("/wp-json/wp/v2/product_cat/25")) {
          return json({
            id: 25,
            name: "Child",
            slug: "child",
            parent: 24,
            link: "https://example.com/product-category/parent/child/",
            description: "Old",
          });
        }
        return json({}, 404);
      }),
    );
    const result = await resolveWpObject(
      credentials,
      "https://example.com/product-category/parent/child/",
    );
    expect(result.ok && result.target).toMatchObject({
      objectType: "term",
      id: 25,
      restBase: "product_cat",
      parentId: 24,
    });
  });

  it("uses the public term record when edit context is forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "https://example.com/product-category/parent/child/") {
          return new Response("", {
            headers: {
              Link: '<https://example.com/wp-json/wp/v2/product_cat/25>; rel="alternate"; type="application/json"',
            },
          });
        }
        if (url.endsWith("/wp-json/wp/v2/taxonomies")) return json({});
        if (url.endsWith("/wp-json/wp/v2/product_cat/25?context=edit")) {
          return json({ code: "rest_forbidden_context" }, 403);
        }
        if (url.endsWith("/wp-json/wp/v2/product_cat/25")) {
          return json({
            id: 25,
            name: "Child",
            slug: "child",
            parent: 24,
            link: "https://example.com/product-category/parent/child/",
            description: "Old",
          });
        }
        return json({}, 404);
      }),
    );

    const result = await resolveWpObject(
      credentials,
      "https://example.com/product-category/parent/child/",
    );
    expect(result.ok && result.target).toMatchObject({
      objectType: "term",
      id: 25,
      contentRaw: "Old",
    });
  });

  it("resolves the configured static front page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/wp-json/wp/v2/settings"))
          return json({ show_on_front: "page", page_on_front: 97 });
        if (url.includes("/wp-json/wp/v2/pages/97"))
          return json({
            id: 97,
            status: "publish",
            link: "https://example.com/",
            title: { raw: "Home" },
            content: {
              raw: "<!-- wp:paragraph --><p>Home</p><!-- /wp:paragraph -->",
            },
          });
        return json({}, 404);
      }),
    );
    const result = await resolveWpObject(credentials, "https://example.com/");
    expect(result.ok && result.target).toMatchObject({
      id: 97,
      subtype: "page",
      isFrontPage: true,
    });
  });

  it("refuses a latest-posts home page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ show_on_front: "posts", page_on_front: 0 })),
    );
    await expect(
      resolveWpObject(credentials, "https://example.com/"),
    ).resolves.toEqual({
      ok: false,
      reason: "Home page shows latest posts; there is no page to edit.",
    });
  });
});
