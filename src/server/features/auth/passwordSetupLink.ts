import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { member, user, verification } from "@/db/schema";
import { AppError } from "@/server/lib/errors";

/**
 * Issue a password set-up link inside the app, with no email involved.
 *
 * Why this exists: sign-in on this instance is Google-only in practice, and
 * "Forgot password?" cannot work because password reset emails go through
 * Loops, which this fork has no account for. That left no way to give someone
 * a password — and no way back in if Google is unavailable to them.
 *
 * Rather than build a parallel password system, this reuses Better Auth's own
 * reset flow end to end. It writes exactly the verification row that Better
 * Auth's POST /reset-password consumes:
 *
 *   identifier = `reset-password:<token>`      value = <userId>
 *
 * The existing /reset-password page then does the rest, unchanged. Two things
 * make that safe to rely on rather than clever:
 *
 *  - Better Auth CREATES the credential account when the user has none, so
 *    this works for a Google-only account that has never had a password.
 *  - The token is single-use: consumeVerificationValue deletes the row.
 *
 * We do NOT go through auth.api.requestPasswordReset, because it hands the URL
 * to the email callback via runInBackgroundOrAwait — which may not be awaited,
 * so capturing the link from there would be a race.
 *
 * The coupling to that identifier format is deliberate and narrow. If a Better
 * Auth upgrade ever changes it, links stop being accepted — a visible, safe
 * failure, not a silent one. passwordSetupLink.test.ts pins the format.
 */

/** Mirrors emailAndPassword.resetPasswordTokenExpiresIn in src/lib/auth.ts. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

const RESET_IDENTIFIER_PREFIX = "reset-password:";

/** URL-safe token. Length matches Better Auth's own generateId(24). */
function generateToken(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

export type PasswordSetupLink = {
  url: string;
  email: string;
  expiresAt: string;
};

/**
 * Create a link that lets `targetEmail` choose a password.
 *
 * Scoped to one organization: the target must be a member of the caller's org,
 * so an owner can never mint a credential for an account outside their own
 * workspace. The caller's permission is checked by the server function; this
 * function enforces the membership boundary.
 */
export async function createPasswordSetupLink(input: {
  organizationId: string;
  targetEmail: string;
  baseUrl: string;
}): Promise<PasswordSetupLink> {
  const email = input.targetEmail.trim().toLowerCase();

  const rows = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .innerJoin(member, eq(member.userId, user.id))
    .where(and(eq(user.email, email), eq(member.organizationId, input.organizationId)))
    .limit(1);

  const target = rows[0];
  if (!target) {
    // One message for "no such user" and "not in this org" so this cannot be
    // used to probe which email addresses have accounts.
    throw new AppError(
      "NOT_FOUND",
      "No member of this organization has that email address.",
    );
  }

  // Invalidate any link already outstanding for this user. Otherwise every
  // link ever issued stays valid until it expires, and a leaked old one is
  // still a way in.
  const existing = await db
    .select({ id: verification.id, value: verification.value })
    .from(verification)
    .where(like(verification.identifier, `${RESET_IDENTIFIER_PREFIX}%`));
  for (const row of existing) {
    if (row.value === target.id) {
      await db.delete(verification).where(eq(verification.id, row.id));
    }
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier: `${RESET_IDENTIFIER_PREFIX}${token}`,
    value: target.id,
    expiresAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const origin = input.baseUrl.replace(/\/+$/, "");
  return {
    url: `${origin}/reset-password?token=${token}`,
    email: target.email,
    expiresAt: expiresAt.toISOString(),
  };
}
