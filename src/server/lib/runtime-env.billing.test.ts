import { describe, expect, it, vi } from "vitest";
import { isBillingEnabled } from "./runtime-env";

/**
 * The fork's one billing invariant: it is never on.
 *
 * Every billing gate in the app routes through isBillingEnabled(), so this is
 * the single test that says "nothing here is ever metered or upsold". It is
 * deliberately independent of AUTH_MODE and of AUTUMN_SECRET_KEY: those are
 * exactly the two knobs upstream uses to switch billing on, and this instance
 * must stay off regardless of how either is set.
 */
vi.mock("cloudflare:workers", () => ({
  env: { AUTH_MODE: "hosted", AUTUMN_SECRET_KEY: "sk_would_enable_upstream" },
}));

describe("isBillingEnabled", () => {
  it("is false even when hosted mode and an Autumn key are both configured", async () => {
    await expect(isBillingEnabled()).resolves.toBe(false);
  });
});
