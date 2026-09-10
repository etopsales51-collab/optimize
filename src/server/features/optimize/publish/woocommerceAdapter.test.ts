import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apply,
  createDraftProduct,
  dryRun,
  resolveProduct,
} from "./woocommerceAdapter";
import type { OptimizeProposal } from "@/shared/optimize";

/**
 * This is the only code that can change a live store, and the credential it
 * uses could change prices, stock and status if the code let it. So these
 * tests are about blast radius, not formatting.
 *
 * The product fixture mirrors the real wacomme.ae STU-430 row: a product whose
 * `name` and whose Rank Math SEO title are DIFFERENT strings. That difference
 * is the whole point — a recommendation's title is an SEO title, and writing it
 * to `name` would rename the product in the catalogue, cart and invoices.
 */

const credentials = {
  baseUrl: "https://wacomme.ae",
  consumerKey: "ck_test",
  consumerSecret: "cs_test_secret_value",
};

const productRow = {
  id: 8119,
  name: "Wacom STU-430 LCD Signature Pad",
  permalink: "https://wacomme.ae/product/wacom-stu-430-lcd-signature-pad/",
  price: "1450",
  stock_status: "instock",
  status: "publish",
  meta_data: [
    { key: "rank_math_title", value: "Wacom STU-430 LCD Signature Pad | UAE" },
    { key: "rank_math_description", value: "Wacom STU-430 4.5-inch pad." },
    { key: "rank_math_focus_keyword", value: "wacom stu-430" },
  ],
};

const proposal: OptimizeProposal = {
  title: {
    before: "Wacom STU-430 LCD Signature Pad | UAE",
    after: "Wacom STU-430 Signature Pad | Buy in Dubai & Abu Dhabi",
  },
  metaDescription: {
    before: "Wacom STU-430 4.5-inch pad.",
    after: "Wacom STU-430 signature pad in the UAE. 1024 pressure levels, USB.",
  },
  sections: [{ heading: "Specs", action: "rewrite", after: "<p>New body</p>" }],
  internalLinks: [],
  notes: "",
};

const PRODUCT_URL = "https://wacomme.ae/product/wacom-stu-430-lcd-signature-pad/";

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

const okLookup = (url: string, init?: RequestInit) =>
  init?.method === "PUT" ? Response.json(productRow) : Response.json([productRow]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveProduct", () => {
  it("resolves a product URL by slug via the WooCommerce API", async () => {
    const spy = mockFetch(okLookup);
    const result = await resolveProduct(credentials, PRODUCT_URL);

    expect(result).toMatchObject({ ok: true, target: { id: 8119 } });
    expect(String(spy.mock.calls[0][0])).toContain(
      "/wp-json/wc/v3/products?slug=wacom-stu-430-lcd-signature-pad",
    );
  });

  it("reads the Rank Math SEO title, which is NOT the product name", async () => {
    mockFetch(okLookup);
    const result = await resolveProduct(credentials, PRODUCT_URL);
    if (!result.ok) throw new Error("expected resolution");

    expect(result.target.name).toBe("Wacom STU-430 LCD Signature Pad");
    expect(result.target.currentSeoTitle).toBe(
      "Wacom STU-430 LCD Signature Pad | UAE",
    );
    expect(result.target.currentSeoTitle).not.toBe(result.target.name);
  });

  it("explains a rejected key without echoing the secret", async () => {
    mockFetch(() => new Response("unauthorized", { status: 401 }));
    const result = await resolveProduct(credentials, PRODUCT_URL);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toContain("rejected the credentials");
      expect(result.reason).not.toContain(credentials.consumerSecret);
    }
  });

  it("says clearly when the URL is not a product", async () => {
    mockFetch(() => Response.json([]));
    const result = await resolveProduct(credentials, "https://wacomme.ae/about-us/");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("not a WooCommerce product");
  });
});

describe("dryRun", () => {
  it("reports the SEO changes without sending a write", async () => {
    const spy = mockFetch(okLookup);
    const result = await dryRun(credentials, PRODUCT_URL, proposal);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changes.map((c) => c.field).sort()).toEqual([
        "rank_math_description",
        "rank_math_title",
      ]);
    }
    for (const [, init] of spy.mock.calls) {
      expect((init as RequestInit | undefined)?.method ?? "GET").toBe("GET");
    }
  });

  it("refuses when the SEO fields already match", async () => {
    mockFetch(okLookup);
    const unchanged: OptimizeProposal = {
      title: { before: "", after: "Wacom STU-430 LCD Signature Pad | UAE" },
      metaDescription: { before: "", after: "Wacom STU-430 4.5-inch pad." },
      sections: [],
      internalLinks: [],
      notes: "",
    };
    const result = await dryRun(credentials, PRODUCT_URL, unchanged);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("already match");
  });
});

describe("apply", () => {
  it("writes ONLY the two Rank Math meta fields", async () => {
    let body: Record<string, unknown> | null = null;
    mockFetch((url, init) => {
      if (init?.method === "PUT") {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json(productRow);
      }
      return Response.json([productRow]);
    });

    const result = await apply(credentials, PRODUCT_URL, proposal);
    expect(result.ok).toBe(true);
    expect(Object.keys(body ?? {})).toEqual(["meta_data"]);

    const metaData = (body as unknown as { meta_data: Array<{ key: string }> })
      .meta_data;
    expect(metaData.map((m) => m.key).sort()).toEqual([
      "rank_math_description",
      "rank_math_title",
    ]);
  });

  it("NEVER renames the product — name is not in the request body", async () => {
    let body: Record<string, unknown> | null = null;
    mockFetch((url, init) => {
      if (init?.method === "PUT") {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json(productRow);
      }
      return Response.json([productRow]);
    });

    await apply(credentials, PRODUCT_URL, proposal);
    // The SEO title differs from the product name; writing it to `name` would
    // change what shoppers see everywhere.
    expect(body).not.toHaveProperty("name");
    expect(JSON.stringify(body)).not.toContain("Buy in Dubai & Abu Dhabi\",\"name");
  });

  it("NEVER touches price, stock, status, categories or images", async () => {
    let body: Record<string, unknown> | null = null;
    mockFetch((url, init) => {
      if (init?.method === "PUT") {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json(productRow);
      }
      return Response.json([productRow]);
    });

    await apply(credentials, PRODUCT_URL, proposal);
    for (const forbidden of [
      "price",
      "regular_price",
      "sale_price",
      "stock_status",
      "stock_quantity",
      "status",
      "categories",
      "images",
      "sku",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it("does not write body content — sections are applied by hand", async () => {
    let body: Record<string, unknown> | null = null;
    mockFetch((url, init) => {
      if (init?.method === "PUT") {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json(productRow);
      }
      return Response.json([productRow]);
    });

    await apply(credentials, PRODUCT_URL, proposal);
    expect(body).not.toHaveProperty("description");
    expect(body).not.toHaveProperty("short_description");
  });

  it("uses PUT against the resolved product id", async () => {
    const spy = mockFetch(okLookup);
    await apply(credentials, PRODUCT_URL, proposal);
    const write = spy.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(String(write?.[0])).toContain("/wp-json/wc/v3/products/8119");
  });

  it("surfaces a write failure rather than reporting success", async () => {
    mockFetch((url, init) =>
      init?.method === "PUT"
        ? new Response("server error", { status: 500 })
        : Response.json([productRow]),
    );
    const result = await apply(credentials, PRODUCT_URL, proposal);
    expect(result).toMatchObject({ ok: false });
  });
});

describe("createDraftProduct (new_page_brief)", () => {
  const brief: OptimizeProposal = {
    title: { before: "", after: "ViRDi AC-5000 IK UAE | Outdoor Fingerprint" },
    metaDescription: { before: "", after: "Buy the ViRDi AC-5000 IK in the UAE." },
    h1: { before: "", after: "ViRDi AC-5000 IK — Outdoor Fingerprint Terminal" },
    sections: [
      { heading: "Product overview", action: "add", after: "<p>Built for harsh sites.</p>" },
      { heading: "Key specifications", action: "add", after: "<p>IP65 / IK09</p>" },
    ],
    internalLinks: [],
    notes: "",
  };
  const NEW_URL = "https://www.ubio.ae/product/virdi-ac-5000-ik/";

  it("creates as a DRAFT — never live without price, images or SKU", async () => {
    let body: Record<string, unknown> | null = null;
    mockFetch((url, init) => {
      if (init?.method === "POST") {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({ id: 900, name: "x", permalink: NEW_URL });
      }
      return Response.json([]); // nothing at that slug yet
    });

    const result = await createDraftProduct(credentials, NEW_URL, brief);
    expect(result.ok).toBe(true);
    expect(body).toMatchObject({ status: "draft" });
  });

  it("names the product from the H1, not the SEO title", async () => {
    let body: Record<string, unknown> | null = null;
    mockFetch((url, init) => {
      if (init?.method === "POST") {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({ id: 900 });
      }
      return Response.json([]);
    });

    await createDraftProduct(credentials, NEW_URL, brief);
    // The SEO title is a search headline; using it as the catalogue name would
    // put marketing copy in the cart and on invoices.
    expect(body).toMatchObject({
      name: "ViRDi AC-5000 IK — Outdoor Fingerprint Terminal",
      slug: "virdi-ac-5000-ik",
    });
    expect(body).not.toMatchObject({ name: brief.title?.after });
  });

  it("sets no price, stock or SKU — a person supplies those", async () => {
    let body: Record<string, unknown> | null = null;
    mockFetch((url, init) => {
      if (init?.method === "POST") {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({ id: 900 });
      }
      return Response.json([]);
    });

    await createDraftProduct(credentials, NEW_URL, brief);
    for (const field of ["regular_price", "price", "sku", "stock_quantity", "categories"]) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it("refuses to create a duplicate when the slug is taken", async () => {
    mockFetch(() => Response.json([productRow]));
    const result = await createDraftProduct(credentials, NEW_URL, brief);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("content_refresh");
  });

  it("refuses a brief with no H1, since there is no product name", async () => {
    mockFetch(() => Response.json([]));
    const result = await createDraftProduct(credentials, NEW_URL, {
      ...brief,
      h1: undefined,
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("no H1");
  });
});
