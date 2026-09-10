import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectPublishSettings } from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import { openSecret, sealSecret } from "@/server/lib/secret-box";
import { isExecutable } from "@/shared/optimize";
import { OptimizeRepository } from "../repositories/OptimizeRepository";
import * as woocommerce from "./woocommerceAdapter";

/**
 * Turns an approved recommendation into a live change.
 *
 * The order here is the safety property, not an implementation detail:
 *
 *   1. the recommendation must be `approved` — the human gate
 *   2. publishing must be switched on for the project — the operator gate
 *   3. the dry run must succeed — the correctness gate
 *   4. only then does anything get written
 *
 * Any failure short-circuits and is recorded on the recommendation, so a
 * failed publish is visible in the UI with its reason rather than silent.
 *
 * NovaMira is not implemented. Where a channel resolves to it, this returns a
 * clear "not configured" rather than pretending — its API is unknown, and a
 * plausible-looking guess that half-works would be worse than an honest stop.
 */

export type CredentialStatus = "missing" | "ok" | "unreadable";

/** Never reveals the secret — only whether it is there and still decryptable. */
async function credentialStatus(sealed: string | null): Promise<CredentialStatus> {
  if (!sealed) return "missing";
  return (await openSecret(sealed)) ? "ok" : "unreadable";
}

export type PublishSettingsView = {
  wordpressBaseUrl: string | null;
  wpUsername: string | null;
  /** Presence and readability only — no secret ever leaves the server. */
  wpCredentialStatus: CredentialStatus;
  wooConsumerKey: string | null;
  wooCredentialStatus: CredentialStatus;
  pagesChannel: "novamira" | "wp_rest" | "manual";
  productsChannel: "novamira" | "wp_rest" | "manual";
  publishingEnabled: boolean;
};

async function getRow(projectId: string) {
  const rows = await db
    .select()
    .from(projectPublishSettings)
    .where(eq(projectPublishSettings.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSettingsView(
  projectId: string,
): Promise<PublishSettingsView> {
  const row = await getRow(projectId);
  if (!row) {
    return {
      wordpressBaseUrl: null,
      wpUsername: null,
      wpCredentialStatus: "missing",
      wooConsumerKey: null,
      wooCredentialStatus: "missing",
      pagesChannel: "manual",
      productsChannel: "wp_rest",
      publishingEnabled: false,
    };
  }

  const [wpStatus, wooStatus] = await Promise.all([
    credentialStatus(row.wpAppPasswordSealed),
    credentialStatus(row.wooConsumerSecretSealed),
  ]);

  return {
    wordpressBaseUrl: row.wordpressBaseUrl,
    wpUsername: row.wpUsername,
    wpCredentialStatus: wpStatus,
    wooConsumerKey: row.wooConsumerKey,
    wooCredentialStatus: wooStatus,
    pagesChannel: row.pagesChannel,
    productsChannel: row.productsChannel,
    publishingEnabled: row.publishingEnabled,
  };
}

export async function saveSettings(input: {
  projectId: string;
  wordpressBaseUrl?: string | null;
  wpUsername?: string | null;
  /** Plaintext, sealed here and never stored or logged as given. */
  wpAppPassword?: string | null;
  wooConsumerKey?: string | null;
  wooConsumerSecret?: string | null;
  pagesChannel?: "novamira" | "wp_rest" | "manual";
  productsChannel?: "novamira" | "wp_rest" | "manual";
  publishingEnabled?: boolean;
}) {
  const existing = await getRow(input.projectId);
  const now = new Date().toISOString();

  // An empty string means "leave the stored password alone"; an explicit null
  // means "remove it". Otherwise a settings save with a blank field would
  // silently wipe a working credential.
  // Blank means "leave the stored secret alone"; explicit null means "remove
  // it". Otherwise saving the form with an empty password field would wipe a
  // working credential.
  const sealIfProvided = async (value: string | null | undefined) =>
    value === undefined || value === ""
      ? undefined
      : value === null
        ? null
        : await sealSecret(value);

  const sealed = await sealIfProvided(input.wpAppPassword);
  const sealedWoo = await sealIfProvided(input.wooConsumerSecret);

  if (!existing) {
    await db.insert(projectPublishSettings).values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      wordpressBaseUrl: input.wordpressBaseUrl ?? null,
      wpUsername: input.wpUsername ?? null,
      wpAppPasswordSealed: sealed ?? null,
      wooConsumerKey: input.wooConsumerKey ?? null,
      wooConsumerSecretSealed: sealedWoo ?? null,
      pagesChannel: input.pagesChannel ?? "manual",
      productsChannel: input.productsChannel ?? "wp_rest",
      publishingEnabled: input.publishingEnabled ?? false,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  await db
    .update(projectPublishSettings)
    .set({
      ...(input.wordpressBaseUrl !== undefined
        ? { wordpressBaseUrl: input.wordpressBaseUrl }
        : {}),
      ...(input.wpUsername !== undefined ? { wpUsername: input.wpUsername } : {}),
      ...(sealed !== undefined ? { wpAppPasswordSealed: sealed } : {}),
      ...(input.wooConsumerKey !== undefined
        ? { wooConsumerKey: input.wooConsumerKey }
        : {}),
      ...(sealedWoo !== undefined
        ? { wooConsumerSecretSealed: sealedWoo }
        : {}),
      ...(input.pagesChannel ? { pagesChannel: input.pagesChannel } : {}),
      ...(input.productsChannel ? { productsChannel: input.productsChannel } : {}),
      ...(input.publishingEnabled !== undefined
        ? { publishingEnabled: input.publishingEnabled }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(projectPublishSettings.id, existing.id),
        eq(projectPublishSettings.projectId, input.projectId),
      ),
    );
}

/** A /product/ URL is WooCommerce; everything else is treated as a page. */
export function channelForUrl(
  url: string,
  settings: { pagesChannel: string; productsChannel: string },
): string {
  let isProduct = false;
  try {
    isProduct = new URL(url).pathname.split("/").filter(Boolean).includes("product");
  } catch {
    isProduct = false;
  }
  return isProduct ? settings.productsChannel : settings.pagesChannel;
}

/**
 * Load the WooCommerce credentials, which is what the implemented channel
 * (product SEO meta) needs. Each failure returns the specific thing to fix,
 * because "publishing failed" with no reason is the least useful message a
 * settings screen can give.
 */
async function loadCredentials(projectId: string) {
  const row = await getRow(projectId);
  if (!row?.publishingEnabled) {
    return {
      error:
        "Publishing is switched off for this project. Turn it on in Project settings → Publishing once the connection is set up.",
    } as const;
  }
  if (!row.wordpressBaseUrl || !row.wooConsumerKey || !row.wooConsumerSecretSealed) {
    return {
      error:
        "WooCommerce is not connected for this project. Add the store URL, consumer key and consumer secret in Project settings → Publishing.",
    } as const;
  }

  const consumerSecret = await openSecret(row.wooConsumerSecretSealed);
  if (!consumerSecret) {
    return {
      error:
        "The stored WooCommerce secret could not be read — it was encrypted under a different BETTER_AUTH_SECRET. Re-enter it in Project settings → Publishing.",
    } as const;
  }

  return {
    row,
    credentials: {
      baseUrl: row.wordpressBaseUrl,
      consumerKey: row.wooConsumerKey,
      consumerSecret,
    },
  } as const;
}

/**
 * Check each stored credential against the live site, read-only.
 *
 * This exists so a credential can be verified without anyone pasting it into a
 * chat, an email or a support thread. The secret stays sealed in the database;
 * the server uses it, and only a verdict comes back.
 *
 * Both checks are GETs. Nothing here can modify the site.
 */
export type ConnectionCheck = {
  channel: "woocommerce" | "wordpress";
  ok: boolean;
  detail: string;
};

export async function testConnections(
  projectId: string,
): Promise<ConnectionCheck[]> {
  const row = await getRow(projectId);
  const results: ConnectionCheck[] = [];

  if (!row?.wordpressBaseUrl) {
    return [
      {
        channel: "woocommerce",
        ok: false,
        detail: "No site URL saved yet.",
      },
    ];
  }
  const base = row.wordpressBaseUrl.replace(/\/+$/, "");

  // WooCommerce — products.
  const consumerSecret = await openSecret(row.wooConsumerSecretSealed);
  if (!row.wooConsumerKey || !consumerSecret) {
    results.push({
      channel: "woocommerce",
      ok: false,
      detail: "Consumer key or secret not saved.",
    });
  } else {
    try {
      const auth = btoa(`${row.wooConsumerKey}:${consumerSecret}`);
      const readResponse = await fetch(
        `${base}/wp-json/wc/v3/products?per_page=1`,
        {
          headers: { Authorization: `Basic ${auth}` },
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (!readResponse.ok) {
        results.push({
          channel: "woocommerce",
          ok: false,
          detail:
            readResponse.status === 401 || readResponse.status === 403
              ? "Rejected (401/403). Check the consumer key and secret."
              : `Store returned ${readResponse.status}.`,
        });
      } else {
        // Reading is not enough. A Read-only key reads perfectly and then
        // fails the moment publishing writes — which is exactly how this test
        // gave false confidence once already.
        //
        // So probe the WRITE permission too, safely: a PUT to an id that
        // cannot exist. WooCommerce checks the key's permission BEFORE it
        // looks the product up, so a read-only key answers 401 "does not have
        // write permissions" while a Read/Write key gets as far as 404. No
        // real product is touched either way.
        const writeProbe = await fetch(
          `${base}/wp-json/wc/v3/products/999999999`,
          {
            method: "PUT",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/json",
            },
            body: "{}",
            signal: AbortSignal.timeout(15_000),
          },
        );

        const canWrite = writeProbe.status !== 401 && writeProbe.status !== 403;
        results.push({
          channel: "woocommerce",
          ok: canWrite,
          detail: canWrite
            ? "Connected — products readable and writable."
            : "Readable, but the key is READ-ONLY, so publishing will fail. In WooCommerce → Settings → Advanced → REST API, set this key's permission to Read/Write (a new secret is issued, so paste both again).",
        });
      }
    } catch {
      results.push({
        channel: "woocommerce",
        ok: false,
        detail: "Could not reach the store. Check the site URL.",
      });
    }
  }

  // WordPress — pages and posts. Optional until a recommendation targets one.
  const appPassword = await openSecret(row.wpAppPasswordSealed);
  if (!row.wpUsername || !appPassword) {
    results.push({
      channel: "wordpress",
      ok: false,
      detail: "Not set up yet — only needed for pages and blog posts.",
    });
    return results;
  }

  try {
    const auth = btoa(`${row.wpUsername}:${appPassword}`);
    // users/me reports who the credential authenticates AS and what it can do,
    // which is what actually matters: an over-privileged account is the risk
    // this credential was chosen to avoid.
    const response = await fetch(`${base}/wp-json/wp/v2/users/me?context=edit`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      results.push({
        channel: "wordpress",
        ok: false,
        detail:
          response.status === 401
            ? "Rejected (401). Check the username and application password."
            : `WordPress returned ${response.status}.`,
      });
      return results;
    }

    const user = (await response.json().catch(() => ({}))) as {
      slug?: string;
      roles?: string[];
      capabilities?: Record<string, boolean>;
    };
    const roles = user.roles?.join(", ") ?? "unknown";
    const canEditPages = user.capabilities?.edit_others_pages === true;
    // Flag an administrator: it works, but it is far more access than
    // publishing SEO copy needs.
    const isAdmin = user.roles?.includes("administrator") === true;

    results.push({
      channel: "wordpress",
      ok: canEditPages,
      detail: canEditPages
        ? `Connected as ${user.slug ?? "user"} (${roles}).${isAdmin ? " This is an administrator — an Editor account would be safer." : ""}`
        : `Connected as ${user.slug ?? "user"} (${roles}), but this account cannot edit other people's pages. Use an Editor.`,
    });
  } catch {
    results.push({
      channel: "wordpress",
      ok: false,
      detail: "Could not reach WordPress. Check the site URL.",
    });
  }

  return results;
}

export type PublishOutcome = {
  ok: boolean;
  reason?: string;
  /** Whether this touches an existing product or brings a new one into being. */
  mode?: woocommerce.PublishMode;
  changes?: woocommerce.PlannedChange[];
};

/** What would happen, touching nothing. Safe to call at any time. */
export async function previewPublish(
  recommendationId: string,
  projectId: string,
): Promise<PublishOutcome> {
  const recommendation = await OptimizeRepository.getRecommendation(
    recommendationId,
    projectId,
  );
  if (!recommendation) throw new AppError("NOT_FOUND", "Recommendation not found.");

  const loaded = await loadCredentials(projectId);
  if ("error" in loaded) return { ok: false, reason: loaded.error };

  const channel = channelForUrl(recommendation.targetUrl, loaded.row);
  if (channel !== "wp_rest") {
    return {
      ok: false,
      reason:
        channel === "novamira"
          ? "This URL routes to NovaMira, which is not connected yet. Switch the channel to WordPress REST, or apply this one by hand."
          : "This URL's channel is set to manual, so it is applied by hand.",
    };
  }

  const result = await woocommerce.plan(
    loaded.credentials,
    recommendation.targetUrl,
    recommendation.proposal,
    { allowCreate: recommendation.type === "new_page_brief" },
  );
  return result.ok
    ? { ok: true, mode: result.mode, changes: result.changes }
    : { ok: false, reason: result.reason };
}

/**
 * Publish an approved recommendation.
 *
 * Refuses anything not in `approved`, so this cannot be used to bypass review
 * even if it were called directly. Records running → succeeded/failed with the
 * reason, and writes a job event either way.
 */
export async function publishApproved(input: {
  recommendationId: string;
  projectId: string;
  actorKey: string;
}): Promise<PublishOutcome> {
  const { recommendationId, projectId, actorKey } = input;

  const recommendation = await OptimizeRepository.getRecommendation(
    recommendationId,
    projectId,
  );
  if (!recommendation) throw new AppError("NOT_FOUND", "Recommendation not found.");

  // The human gate, re-checked at the moment of writing rather than trusted
  // from whoever called this.
  if (!isExecutable(recommendation.status)) {
    throw new AppError(
      "CONFLICT",
      `Only an approved recommendation can be published; this one is ${recommendation.status}.`,
    );
  }

  const loaded = await loadCredentials(projectId);
  if ("error" in loaded) return { ok: false, reason: loaded.error };

  const channel = channelForUrl(recommendation.targetUrl, loaded.row);
  if (channel !== "wp_rest") {
    return {
      ok: false,
      reason:
        channel === "novamira"
          ? "This URL routes to NovaMira, which is not connected yet."
          : "This URL's channel is set to manual.",
    };
  }

  await OptimizeRepository.updateRecommendation(recommendationId, projectId, {
    status: "running",
    execution: { channel: "wp_rest" },
  });

  // The store decides whether this is a create or an update — see the adapter.
  // The type only decides whether creating is allowed at all, because only a
  // brief carries the cannibalization check that makes a new URL safe.
  const result = await woocommerce.publish(
    loaded.credentials,
    recommendation.targetUrl,
    recommendation.proposal,
    { allowCreate: recommendation.type === "new_page_brief" },
  );

  if (!result.ok) {
    await OptimizeRepository.updateRecommendation(recommendationId, projectId, {
      status: "failed",
      execution: { channel: "wp_rest", dryRunOk: false, error: result.reason },
    });
    await OptimizeRepository.addJobEvent({
      id: crypto.randomUUID(),
      recommendationId,
      eventType: "publish_failed",
      actor: actorKey,
      detail: { reason: result.reason },
    });
    return { ok: false, reason: result.reason };
  }

  await OptimizeRepository.updateRecommendation(recommendationId, projectId, {
    status: "succeeded",
    execution: {
      channel: "wp_rest",
      dryRunOk: true,
      externalJobId: `product/${result.target.id}`,
    },
  });
  await OptimizeRepository.addJobEvent({
    id: crypto.randomUUID(),
    recommendationId,
    eventType: "published",
    actor: actorKey,
    detail: {
      target: `product/${result.target.id}`,
      productName: result.target.name,
      mode: result.mode,
      fields: result.applied.map((change) => change.field),
      // The previous values, kept so a bad publish can be undone by hand —
      // WooCommerce keeps no revision history for meta fields.
      previous: result.applied.map((change) => ({
        field: change.field,
        before: change.before,
      })),
      revisionHint: result.revisionHint,
    },
  });

  return { ok: true, mode: result.mode, changes: result.applied };
}
