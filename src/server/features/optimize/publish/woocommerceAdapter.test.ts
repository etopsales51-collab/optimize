import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inferBrand,
  matchBrandCategory,
  plan,
  publish,
  resolveProduct,
  type ProductCategory,
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
  categories: [
    { id: 17, name: "Signature Pads", slug: "signature-pads", count: 12 },
  ],
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
const UPDATE = { allowCreate: false };
const CREATE = { allowCreate: true };

type Handler = (url: string, init?: RequestInit) => Response;

function mockFetch(handler: Handler) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/**
 * A store that answers every endpoint the adapter touches. `product` is what a
 * slug lookup returns (null for "nothing there yet"), `categories` what a
 * category search returns, and `onWrite` captures the request body.
 */
function mockStore(options: {
  product?: Record<string, unknown> | null;
  categories?: ProductCategory[];
  onWrite?: (body: Record<string, unknown>, url: string) => void;
  writeStatus?: number;
}) {
  const bodies: Record<string, unknown>[] = [];
  const spy = mockFetch((url, init) => {
    const method = init?.method ?? "GET";

    if (url.includes("/products/categories")) {
      if (method === "POST") {
        const created = JSON.parse(String(init?.body)) as { name: string };
        return Response.json({
          id: 777,
          name: created.name,
          slug: created.name.toLowerCase(),
          count: 0,
        });
      }
      return Response.json(options.categories ?? []);
    }

    if (method === "GET") {
      return Response.json(options.product ? [options.product] : []);
    }

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    options.onWrite?.(body, url);
    if (options.writeStatus) {
      return new Response("error", { status: options.writeStatus });
    }
    return Response.json({ ...(options.product ?? {}), id: 900, ...body });
  });

  return { spy, bodies, get body() { return bodies[0] ?? null; } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveProduct", () => {
  it("resolves a product URL by slug via the WooCommerce API", async () => {
    const store = mockStore({ product: productRow });
    const result = await resolveProduct(credentials, PRODUCT_URL);

    expect(result).toMatchObject({ ok: true, target: { id: 8119 } });
    expect(String(store.spy.mock.calls[0][0])).toContain(
      "/wp-json/wc/v3/products?slug=wacom-stu-430-lcd-signature-pad",
    );
  });

  it("finds drafts too, so a product created earlier is never duplicated", async () => {
    const store = mockStore({ product: { ...productRow, status: "draft" } });
    const result = await resolveProduct(credentials, PRODUCT_URL);

    expect(result).toMatchObject({ ok: true, target: { status: "draft" } });
    expect(String(store.spy.mock.calls[0][0])).toContain("status=any");
  });

  it("reads the Rank Math SEO title, which is NOT the product name", async () => {
    mockStore({ product: productRow });
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
});

describe("plan", () => {
  it("reports the SEO changes without sending a write", async () => {
    const store = mockStore({ product: productRow });
    const result = await plan(credentials, PRODUCT_URL, proposal, UPDATE);

    expect(result).toMatchObject({ ok: true, mode: "update", productId: 8119 });
    if (result.ok) {
      expect(result.changes.map((change) => change.field).sort()).toEqual([
        "rank_math_description",
        "rank_math_title",
      ]);
    }
    for (const [, init] of store.spy.mock.calls) {
      expect((init as RequestInit | undefined)?.method ?? "GET").toBe("GET");
    }
  });

  it("plans nothing when the SEO fields already match", async () => {
    mockStore({ product: productRow });
    const unchanged: OptimizeProposal = {
      title: { before: "", after: "Wacom STU-430 LCD Signature Pad | UAE" },
      metaDescription: { before: "", after: "Wacom STU-430 4.5-inch pad." },
      sections: [],
      internalLinks: [],
      notes: "",
    };
    const result = await plan(credentials, PRODUCT_URL, unchanged, UPDATE);
    expect(result).toMatchObject({ ok: true, mode: "update" });
    if (result.ok) expect(result.changes).toEqual([]);
  });

  it("refuses to update a URL that has no product, and says what to do", async () => {
    mockStore({ product: null });
    const result = await plan(credentials, PRODUCT_URL, proposal, UPDATE);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("new page brief");
  });
});

describe("publish — updating an existing product", () => {
  it("writes ONLY the two Rank Math meta fields", async () => {
    const store = mockStore({ product: productRow });

    const result = await publish(credentials, PRODUCT_URL, proposal, UPDATE);
    expect(result).toMatchObject({ ok: true, mode: "update" });
    expect(Object.keys(store.body ?? {})).toEqual(["meta_data"]);

    const metaData = (store.body as unknown as { meta_data: Array<{ key: string }> })
      .meta_data;
    expect(metaData.map((row) => row.key).sort()).toEqual([
      "rank_math_description",
      "rank_math_title",
    ]);
  });

  it("NEVER renames the product — name is not in the request body", async () => {
    const store = mockStore({ product: productRow });
    await publish(credentials, PRODUCT_URL, proposal, UPDATE);
    // The SEO title differs from the product name; writing it to `name` would
    // change what shoppers see everywhere.
    expect(store.body).not.toHaveProperty("name");
  });

  it("NEVER touches price, stock, SKU or images", async () => {
    const store = mockStore({ product: productRow });
    await publish(credentials, PRODUCT_URL, proposal, UPDATE);

    for (const forbidden of [
      "price",
      "regular_price",
      "sale_price",
      "stock_status",
      "stock_quantity",
      "images",
      "sku",
    ]) {
      expect(store.body).not.toHaveProperty(forbidden);
    }
  });

  it("leaves the status and categories of a live, categorised product alone", async () => {
    const store = mockStore({ product: productRow });
    await publish(credentials, PRODUCT_URL, proposal, UPDATE);
    expect(store.body).not.toHaveProperty("status");
    expect(store.body).not.toHaveProperty("categories");
  });

  it("does not write body content — sections are applied by hand", async () => {
    const store = mockStore({ product: productRow });
    await publish(credentials, PRODUCT_URL, proposal, UPDATE);
    expect(store.body).not.toHaveProperty("description");
    expect(store.body).not.toHaveProperty("short_description");
  });

  it("uses PUT against the resolved product id", async () => {
    const store = mockStore({ product: productRow });
    await publish(credentials, PRODUCT_URL, proposal, UPDATE);
    const write = store.spy.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(String(write?.[0])).toContain("/wp-json/wc/v3/products/8119");
  });

  it("surfaces a write failure rather than reporting success", async () => {
    mockStore({ product: productRow, writeStatus: 500 });
    const result = await publish(credentials, PRODUCT_URL, proposal, UPDATE);
    expect(result).toMatchObject({ ok: false });
  });

  it("succeeds without writing when the store already matches", async () => {
    const store = mockStore({ product: productRow });
    const unchanged: OptimizeProposal = {
      title: { before: "", after: "Wacom STU-430 LCD Signature Pad | UAE" },
      metaDescription: { before: "", after: "Wacom STU-430 4.5-inch pad." },
      sections: [],
      internalLinks: [],
      notes: "",
    };

    // Re-publishing something already applied is not a failure; the store is
    // in the state the recommendation asked for.
    const result = await publish(credentials, PRODUCT_URL, unchanged, UPDATE);
    expect(result).toMatchObject({ ok: true, applied: [] });
    expect(store.bodies).toEqual([]);
  });

  it("takes a draft live, and never the other way round", async () => {
    const store = mockStore({ product: { ...productRow, status: "draft" } });
    await publish(credentials, PRODUCT_URL, proposal, UPDATE);
    expect(store.body).toMatchObject({ status: "publish" });

    vi.unstubAllGlobals();
    const live = mockStore({ product: productRow });
    await publish(credentials, PRODUCT_URL, proposal, UPDATE);
    expect(live.body).not.toHaveProperty("status");
  });

  it("files an uncategorised product under its brand", async () => {
    const store = mockStore({
      product: {
        ...productRow,
        name: "Nitgen eNBioAccess-T9",
        categories: [
          { id: 15, name: "Uncategorized", slug: "uncategorized", count: 1 },
        ],
      },
      categories: [
        { id: 16, name: "Nitgen Biometric Devices", slug: "nitgen-biometric-devices", count: 9 },
        { id: 44, name: "Nitgen Fingerprint Scanners", slug: "nitgen-fingerprint-scanners", count: 0 },
      ],
    });

    await publish(credentials, PRODUCT_URL, proposal, UPDATE);
    // Joins the nine siblings, not the empty namesake.
    expect(store.body).toMatchObject({ categories: [{ id: 16 }] });
  });
});

describe("publish — creating from a new page brief", () => {
  const brief: OptimizeProposal = {
    title: { before: "", after: "ViRDi AC-5000 IK UAE | Outdoor Fingerprint" },
    metaDescription: { before: "", after: "Buy the ViRDi AC-5000 IK in the UAE." },
    h1: { before: "", after: "ViRDi AC-5000 IK — Outdoor Fingerprint Terminal" },
    sections: [
      {
        heading: "Product overview",
        action: "add",
        after: "<p>Built for harsh sites.</p>",
      },
      { heading: "Key specifications", action: "add", after: "<p>IP65 / IK09</p>" },
    ],
    internalLinks: [],
    notes: "",
  };
  const NEW_URL = "https://www.ubio.ae/product/virdi-ac-5000-ik/";

  it("creates the product PUBLISHED — approval was the review", async () => {
    const store = mockStore({ product: null });
    const result = await publish(credentials, NEW_URL, brief, CREATE);

    expect(result).toMatchObject({ ok: true, mode: "create" });
    expect(store.body).toMatchObject({ status: "publish" });
  });

  it("names the product from the H1, not the SEO title", async () => {
    const store = mockStore({ product: null });
    await publish(credentials, NEW_URL, brief, CREATE);

    // The SEO title is a search headline; using it as the catalogue name would
    // put marketing copy in the cart and on invoices.
    expect(store.body).toMatchObject({
      name: "ViRDi AC-5000 IK — Outdoor Fingerprint Terminal",
      slug: "virdi-ac-5000-ik",
    });
    expect(store.body).not.toMatchObject({ name: brief.title?.after });
  });

  it("sets no price, stock or SKU — a person supplies those", async () => {
    const store = mockStore({ product: null });
    await publish(credentials, NEW_URL, brief, CREATE);

    for (const field of ["regular_price", "price", "sku", "stock_quantity"]) {
      expect(store.body).not.toHaveProperty(field);
    }
  });

  it("creates the brand category when the store has none", async () => {
    const store = mockStore({ product: null, categories: [] });
    await publish(credentials, NEW_URL, brief, CREATE);

    const created = store.spy.mock.calls.find(
      ([url, init]) =>
        String(url).includes("/products/categories") &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(JSON.parse(String((created?.[1] as RequestInit).body))).toEqual({
      name: "ViRDi",
    });
    expect(store.body).toMatchObject({ categories: [{ id: 777 }] });
  });

  it("updates the existing product instead of failing when the slug is taken", async () => {
    // The bug this replaced: publishing a brief, revising it, then publishing
    // again refused outright because "a product already exists".
    const store = mockStore({ product: { ...productRow, status: "draft" } });
    const result = await publish(credentials, NEW_URL, brief, CREATE);

    expect(result).toMatchObject({ ok: true, mode: "update" });
    expect(store.body).not.toHaveProperty("name");
    expect(store.body).toMatchObject({ status: "publish" });
  });

  it("refuses a brief with no H1, since there is no product name", async () => {
    mockStore({ product: null });
    const result = await publish(credentials, NEW_URL, { ...brief, h1: undefined }, CREATE);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain("no H1");
  });
});

describe("inferBrand", () => {
  it("takes the brand an agent states over anything guessed", () => {
    expect(inferBrand({ brand: "UBio" }, "AC-5000 IK Terminal")).toBe("UBio");
  });

  it("reads the leading word of a product name", () => {
    expect(inferBrand({}, "ViRDi AC-5000 IK — Outdoor Terminal")).toBe("ViRDi");
    expect(inferBrand({}, "Nitgen eNBioAccess-T9")).toBe("Nitgen");
  });

  it("stops at the hyphen that starts a model, but not inside one", () => {
    // The brand is UBio; UBio-X is a product line.
    expect(inferBrand({}, "UBio-X Face Pro")).toBe("UBio");
    // ...while AC-5000 must not become "AC".
    expect(inferBrand({}, "AC-5000 Fingerprint Reader")).toBe("AC5000");
  });

  it("returns nothing rather than guess from a name with no brand", () => {
    expect(inferBrand({}, "The Best Fingerprint Reader")).toBeNull();
    expect(inferBrand({}, "")).toBeNull();
  });
});

describe("matchBrandCategory", () => {
  const categories: ProductCategory[] = [
    { id: 16, name: "Nitgen Biometric Devices", slug: "nitgen-biometric-devices", count: 9 },
    { id: 44, name: "Nitgen Fingerprint Scanners", slug: "nitgen-fingerprint-scanners", count: 0 },
    { id: 15, name: "Uncategorized", slug: "uncategorized", count: 1 },
  ];

  it("prefers an exact category over one that merely contains the brand", () => {
    const exact = [...categories, { id: 90, name: "Nitgen", slug: "nitgen", count: 0 }];
    expect(matchBrandCategory(exact, "nitgen")?.id).toBe(90);
  });

  it("falls back to the busiest category containing the brand as a word", () => {
    expect(matchBrandCategory(categories, "Nitgen")?.id).toBe(16);
  });

  it("finds nothing for a brand the store has never used", () => {
    expect(matchBrandCategory(categories, "ViRDi")).toBeNull();
  });

  it("does not match a brand buried inside a longer word", () => {
    const misleading: ProductCategory[] = [
      { id: 5, name: "Interface Panels", slug: "interface-panels", count: 3 },
    ];
    expect(matchBrandCategory(misleading, "Face")).toBeNull();
  });
});
