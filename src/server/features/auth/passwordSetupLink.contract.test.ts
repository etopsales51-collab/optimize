import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract test against the installed Better Auth.
 *
 * createPasswordSetupLink writes a verification row that Better Auth's
 * POST /reset-password consumes. That coupling is invisible at compile time —
 * nothing in our types references the identifier format — so an upgrade could
 * silently change it and every link we hand out would stop working, with no
 * failing build to warn us.
 *
 * These assertions read Better Auth's own shipped source. If they fail after an
 * upgrade, read that file and update passwordSetupLink.ts to match.
 */
const passwordRoutes = readFileSync(
  join(
    process.cwd(),
    "node_modules/better-auth/dist/api/routes/password.mjs",
  ),
  "utf8",
);

describe("Better Auth reset-password contract", () => {
  it("still keys reset tokens as `reset-password:<token>`", () => {
    expect(passwordRoutes).toContain("`reset-password:${token}`");
  });

  it("still stores the user id as the verification value", () => {
    // requestPasswordReset writes value: user.user.id; resetPassword reads it
    // back as the user to update. Our generator writes the same thing.
    expect(passwordRoutes).toContain("const userId = verification.value;");
  });

  it("still consumes the token, making each link single-use", () => {
    expect(passwordRoutes).toContain("consumeVerificationValue(id)");
  });

  it("still CREATES a credential account when the user has none", () => {
    // This is what makes a password link work for a Google-only account that
    // has never had a password — the case this feature exists for.
    expect(passwordRoutes).toContain('providerId === "credential"');
    expect(passwordRoutes).toContain("createAccount({");
  });
});

describe("our generated link", () => {
  it("targets the app's own reset page with the token in the query", () => {
    // The /reset-password route reads `token` from the search params and posts
    // it to Better Auth, so the link can skip Better Auth's redirect endpoint.
    const page = readFileSync(
      join(process.cwd(), "src/routes/reset-password.tsx"),
      "utf8",
    );
    expect(page).toContain("token: z.string().optional()");
    expect(page).toContain("authClient.resetPassword");
  });
});
