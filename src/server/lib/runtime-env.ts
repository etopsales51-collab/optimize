import { isHostedAuthMode } from "@/lib/auth-mode";

let workersEnvPromise: Promise<Record<string, unknown> | null> | null = null;

export async function getOptionalEnvValue(
  name: string,
): Promise<string | undefined> {
  return getEnvValueSync((await getWorkersEnv()) ?? {}, name);
}

/**
 * Sync variant for callers that already hold an env record (e.g. a Durable
 * Object's `this.env`, needed because Think's `getModel()` hook is sync).
 * Same policy as the async form: process.env first (where local `.env.local`
 * secrets land in dev), skipping empty strings, then the given env.
 */
export function getEnvValueSync(
  // `object` so interface-typed envs (e.g. Cloudflare.Env) are accepted
  // without a cast.
  env: object,
  name: string,
): string | undefined {
  const processValue =
    typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (processValue) {
    return processValue;
  }
  const value: unknown = Reflect.get(env, name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export async function getRequiredEnvValue(name: string): Promise<string> {
  const value = await getOptionalEnvValue(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function isHostedServerAuthMode(): Promise<boolean> {
  return isHostedAuthMode(await getOptionalEnvValue("AUTH_MODE"));
}

/**
 * Whether to meter and gate on the commercial billing provider. Always false.
 *
 * This is a fork running on its own DataForSEO and Google credentials. It sells
 * nothing and has no Autumn account, so no request here is ever billable.
 *
 * Upstream reads AUTH_MODE for this, because for them "hosted" means the paid
 * SaaS. Here it means only Better Auth + Google sign-in. Conflating the two
 * killed every metered path — site audits, rank checks, AI Visibility and *all*
 * DataForSEO research — with "Missing required environment variable:
 * AUTUMN_SECRET_KEY", because the app was asking a payment provider we have no
 * account with whether we were allowed to run our own API key.
 *
 * Deliberately a constant rather than a check on AUTUMN_SECRET_KEY: billing
 * must not be one stray environment variable away from switching itself on.
 * Every billing call site routes through here, so this single line is the
 * guarantee. The gates and Autumn client stay in the tree untouched so upstream
 * merges keep applying.
 */
export async function isBillingEnabled(): Promise<boolean> {
  return false;
}

async function getWorkersEnv(): Promise<Record<string, unknown> | null> {
  if (!workersEnvPromise) {
    workersEnvPromise = loadWorkersEnv();
  }
  return workersEnvPromise;
}

async function loadWorkersEnv(): Promise<Record<string, unknown> | null> {
  try {
    const workersModule = await import("cloudflare:workers");
    return isRecord(workersModule.env) ? workersModule.env : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
