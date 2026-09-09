import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These protect a WordPress application password, so the properties worth
 * asserting are the security ones: the plaintext must not be recoverable from
 * the stored form without the key, and a tampered value must fail closed.
 */

const mocks = vi.hoisted(() => ({ secret: "test-root-secret-value" as string | null }));

vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: vi.fn(async (name: string) =>
    name === "BETTER_AUTH_SECRET" ? mocks.secret : null,
  ),
}));

const { sealSecret, openSecret, canOpenSecret } = await import("./secret-box");

beforeEach(() => {
  mocks.secret = "test-root-secret-value";
});

describe("secret box", () => {
  it("round-trips a credential", async () => {
    const sealed = await sealSecret("wp app password 1234");
    await expect(openSecret(sealed)).resolves.toBe("wp app password 1234");
  });

  it("never stores the plaintext", async () => {
    const sealed = await sealSecret("hunter2-application-password");
    expect(sealed).not.toContain("hunter2");
    expect(sealed.startsWith("v1.")).toBe(true);
  });

  it("produces a different ciphertext each time, so equal secrets are not linkable", async () => {
    const a = await sealSecret("same value");
    const b = await sealSecret("same value");
    expect(a).not.toBe(b);
    await expect(openSecret(a)).resolves.toBe("same value");
    await expect(openSecret(b)).resolves.toBe("same value");
  });

  it("fails closed on a tampered ciphertext rather than returning garbage", async () => {
    const sealed = await sealSecret("original");
    const [version, iv, data] = sealed.split(".");
    const flipped = data.startsWith("A") ? `B${data.slice(1)}` : `A${data.slice(1)}`;
    await expect(openSecret(`${version}.${iv}.${flipped}`)).resolves.toBeNull();
  });

  it("cannot be read under a different root secret", async () => {
    const sealed = await sealSecret("secret under key one");
    mocks.secret = "a-completely-different-secret";
    // This is the rotation consequence, asserted so it is a known property
    // rather than a surprise: rotating BETTER_AUTH_SECRET orphans stored
    // credentials and they must be re-entered.
    await expect(openSecret(sealed)).resolves.toBeNull();
    await expect(canOpenSecret(sealed)).resolves.toBe(false);
  });

  it("treats a malformed or absent value as unreadable", async () => {
    await expect(openSecret(null)).resolves.toBeNull();
    await expect(openSecret("")).resolves.toBeNull();
    await expect(openSecret("not-sealed-at-all")).resolves.toBeNull();
    await expect(openSecret("v2.aaa.bbb")).resolves.toBeNull();
  });

  it("refuses to seal when the root secret is missing", async () => {
    mocks.secret = null;
    await expect(sealSecret("anything")).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });
});
