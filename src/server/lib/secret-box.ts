import { getOptionalEnvValue } from "@/server/lib/runtime-env";

/**
 * Symmetric encryption for credentials this app stores on behalf of a project
 * — today, WordPress publishing credentials.
 *
 * Why this exists: a WordPress application password can modify a live store.
 * It must never sit in the database in plaintext, never be returned to a
 * client, and never appear in an MCP tool result or an agent's context. This
 * module is the only place such a value is readable, and only server-side.
 *
 * AES-256-GCM via Web Crypto, which is available in workerd and Node alike.
 * GCM is authenticated, so a tampered ciphertext fails to decrypt rather than
 * silently yielding garbage that we then send to WordPress as a password.
 *
 * The key derives from BETTER_AUTH_SECRET, the same root secret Better Auth
 * uses for its own OAuth token encryption. That means one secret to protect,
 * and it carries the same consequence: **rotating BETTER_AUTH_SECRET makes
 * previously stored credentials undecryptable** and they must be re-entered.
 * That is a deliberate trade — a second secret to manage would be one more
 * thing to lose.
 *
 * Format: `v1.<base64url iv>.<base64url ciphertext>`. The version prefix is
 * there so a future algorithm change can be detected rather than guessed at.
 */

const VERSION = "v1";
const IV_BYTES = 12; // 96 bits, the size AES-GCM is specified for.

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Allocates over a concrete ArrayBuffer: Web Crypto's BufferSource excludes
// SharedArrayBuffer-backed views, which a bare `new Uint8Array(n)` can be.
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  const secret = (await getOptionalEnvValue("BETTER_AUTH_SECRET"))?.trim();
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required to store or read publishing credentials.",
    );
  }
  // SHA-256 of the root secret gives exactly the 256 bits AES-GCM wants,
  // without assuming anything about the secret's own length or alphabet.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`deep-insights:secret-box:${secret}`),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

/**
 * Returns null rather than throwing when the value cannot be read — a
 * credential encrypted under a rotated secret should surface as "reconnect
 * publishing", not as a 500 on an unrelated settings page.
 */
export async function openSecret(sealed: string | null): Promise<string | null> {
  if (!sealed) return null;
  const [version, ivPart, dataPart] = sealed.split(".");
  if (version !== VERSION || !ivPart || !dataPart) return null;

  try {
    const key = await getKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(ivPart) },
      key,
      fromBase64Url(dataPart),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/** True when a stored value is present and still readable under the current key. */
export async function canOpenSecret(sealed: string | null): Promise<boolean> {
  return (await openSecret(sealed)) !== null;
}
