import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectPublishSettings } from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import { openSecret, sealSecret } from "@/server/lib/secret-box";
import { isExecutable, isProductUrl } from "@/shared/optimize";
import { loadImage } from "../optimizeImages";
import { OptimizeRepository } from "../repositories/OptimizeRepository";
import * as woocommerce from "./woocommerceAdapter";
import * as wordpress from "./wordpressAdapter";
import { alertPublishResult } from "@/server/features/whatsapp/whatsappAlerts";

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
async function credentialStatus(
  sealed: string | null,
): Promise<CredentialStatus> {
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

export async function getWordpressPageConnection(projectId: string): Promise<
  | {
      ok: true;
      credentials: wordpress.WordpressCredentials;
      publishingEnabled: boolean;
    }
  | { ok: false; reason: string }
> {
  const row = await getRow(projectId);
  if (!row?.wordpressBaseUrl || !row.wpUsername || !row.wpAppPasswordSealed) {
    return {
      ok: false,
      reason: "Connect WordPress in Project settings → Publishing first.",
    };
  }
  const appPassword = await openSecret(row.wpAppPasswordSealed);
  if (!appPassword) {
    return {
      ok: false,
      reason:
        "The stored WordPress application password cannot be read. Re-enter it in Project settings → Publishing.",
    };
  }
  return {
    ok: true,
    credentials: {
      baseUrl: row.wordpressBaseUrl,
      username: row.wpUsername,
      appPassword,
    },
    publishingEnabled: row.publishingEnabled,
  };
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
      ...(input.wpUsername !== undefined
        ? { wpUsername: input.wpUsername }
        : {}),
      ...(sealed !== undefined ? { wpAppPasswordSealed: sealed } : {}),
      ...(input.wooConsumerKey !== undefined
        ? { wooConsumerKey: input.wooConsumerKey }
        : {}),
      ...(sealedWoo !== undefined
        ? { wooConsumerSecretSealed: sealedWoo }
        : {}),
      ...(input.pagesChannel ? { pagesChannel: input.pagesChannel } : {}),
      ...(input.productsChannel
        ? { productsChannel: input.productsChannel }
        : {}),
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

type PublishTarget =
  | { adapter: "woocommerce"; credentials: woocommerce.WooCredentials }
  | { adapter: "wordpress"; credentials: wordpress.WordpressCredentials };

/**
 * Pick the adapter for this URL and load its credentials. Each failure returns
 * the specific thing to fix, because "publishing failed" with no reason is the
 * least useful message a settings screen can give.
 *
 * Products go through WooCommerce, pages and posts through WordPress. For
 * pages, the saved WordPress application password is the switch: the stored
 * `pagesChannel` defaulted to "manual" with no screen to change it, so it is
 * not read as a choice anyone made. Only NovaMira, still unbuilt, stops it.
 */
async function loadPublishTarget(
  projectId: string,
  targetUrl: string,
): Promise<PublishTarget | { error: string }> {
  const row = await getRow(projectId);
  if (!row?.publishingEnabled) {
    return {
      error:
        "Publishing is switched off for this project. Turn it on in Project settings → Publishing once the connection is set up.",
    };
  }
  if (!row.wordpressBaseUrl) {
    return {
      error:
        "No site URL is saved for this project. Add it in Project settings → Publishing.",
    };
  }

  if (isProductUrl(targetUrl)) {
    if (row.productsChannel !== "wp_rest") {
      return {
        error:
          row.productsChannel === "novamira"
            ? "Product URLs route to NovaMira, which is not connected yet."
            : "Product URLs are set to be applied by hand for this project.",
      };
    }
    if (!row.wooConsumerKey || !row.wooConsumerSecretSealed) {
      return {
        error:
          "WooCommerce is not connected for this project. Add the consumer key and consumer secret in Project settings → Publishing.",
      };
    }
    const consumerSecret = await openSecret(row.wooConsumerSecretSealed);
    if (!consumerSecret) {
      return {
        error:
          "The stored WooCommerce secret could not be read — it was encrypted under a different BETTER_AUTH_SECRET. Re-enter it in Project settings → Publishing.",
      };
    }
    return {
      adapter: "woocommerce",
      credentials: {
        baseUrl: row.wordpressBaseUrl,
        consumerKey: row.wooConsumerKey,
        consumerSecret,
      },
    };
  }

  if (row.pagesChannel === "novamira") {
    return {
      error: "Pages and posts route to NovaMira, which is not connected yet.",
    };
  }
  if (!row.wpUsername || !row.wpAppPasswordSealed) {
    return {
      error:
        "This URL is a page or blog post, not a product, so it publishes through WordPress. Add a WordPress username and application password (an Editor account) in Project settings → Publishing.",
    };
  }
  const appPassword = await openSecret(row.wpAppPasswordSealed);
  if (!appPassword) {
    return {
      error:
        "The stored WordPress application password could not be read — it was encrypted under a different BETTER_AUTH_SECRET. Re-enter it in Project settings → Publishing.",
    };
  }
  return {
    adapter: "wordpress",
    credentials: {
      baseUrl: row.wordpressBaseUrl,
      username: row.wpUsername,
      appPassword,
    },
  };
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
    const response = await fetch(
      `${base}/wp-json/wp/v2/users/me?context=edit`,
      {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(15_000),
      },
    );

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

/**
 * Read-only look at what a product actually stores.
 *
 * Exists to answer one question without anyone pasting a credential anywhere:
 * which meta key does this store's product template read for its datasheet?
 * wacomme.ae renders a per-product datasheet button from a shared Elementor
 * template, so the URL must live on the product — this shows where. Values are
 * truncated because a meta field can hold a whole Elementor document, and the
 * secret stays sealed server-side as with every other call here.
 */
export type ProductFieldInspection =
  | {
      ok: true;
      productId: number;
      name: string;
      status: string;
      categories: string[];
      metaKeys: Array<{ key: string; value: string }>;
    }
  | { ok: false; reason: string };

export async function inspectProductFields(
  projectId: string,
  productUrl: string,
): Promise<ProductFieldInspection> {
  const row = await getRow(projectId);
  const consumerSecret = await openSecret(row?.wooConsumerSecretSealed ?? null);
  if (!row?.wordpressBaseUrl || !row.wooConsumerKey || !consumerSecret) {
    return {
      ok: false,
      reason:
        "WooCommerce is not connected for this project — save the store URL, key and secret first.",
    };
  }

  const credentials = {
    baseUrl: row.wordpressBaseUrl,
    consumerKey: row.wooConsumerKey,
    consumerSecret,
  };
  const resolved = await woocommerce.resolveProduct(credentials, productUrl);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  const base = row.wordpressBaseUrl.replace(/\/+$/, "");
  const auth = btoa(`${row.wooConsumerKey}:${consumerSecret}`);
  const response = await fetch(
    `${base}/wp-json/wc/v3/products/${resolved.target.id}`,
    {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    return {
      ok: false,
      reason: `Store returned ${response.status} for the product.`,
    };
  }

  const product = (await response.json().catch(() => ({}))) as {
    meta_data?: Array<{ key?: string; value?: unknown }>;
  };
  const metaKeys = (product.meta_data ?? [])
    .filter((entry) => typeof entry.key === "string")
    .map((entry) => {
      const raw =
        typeof entry.value === "string"
          ? entry.value
          : JSON.stringify(entry.value ?? "");
      return { key: entry.key as string, value: raw.slice(0, 160) };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    ok: true,
    productId: resolved.target.id,
    name: resolved.target.name,
    status: resolved.target.status,
    categories: resolved.target.categories.map((category) => category.name),
    metaKeys,
  };
}

export type PublishChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export type PublishOutcome = {
  ok: boolean;
  reason?: string;
  /** Whether this touches an existing item or brings a new one into being. */
  mode?: "create" | "update";
  /** What is being published, for the UI's wording. */
  kind?: "product" | "post" | "page";
  changes?: PublishChange[];
};

type Recommendation = NonNullable<
  Awaited<ReturnType<typeof OptimizeRepository.getRecommendation>>
>;

function adapterOptions(recommendation: Recommendation) {
  return {
    // Only a brief carries the cannibalization check that makes a new URL safe.
    allowCreate: recommendation.type === "new_page_brief",
    focusKeyword: recommendation.primaryQuery,
    updateContent: recommendation.type === "content_refresh",
    // Article images were copied into the app when the agent wrote them.
    loadImage: async (image: { assetId?: string }) =>
      image.assetId ? loadImage(recommendation.projectId, image.assetId) : null,
  };
}

/** What would happen, touching nothing. Safe to call at any time. */
export async function previewPublish(
  recommendationId: string,
  projectId: string,
): Promise<PublishOutcome> {
  const recommendation = await OptimizeRepository.getRecommendation(
    recommendationId,
    projectId,
  );
  if (!recommendation)
    throw new AppError("NOT_FOUND", "Recommendation not found.");

  const target = await loadPublishTarget(projectId, recommendation.targetUrl);
  if ("error" in target) return { ok: false, reason: target.error };

  if (target.adapter === "wordpress") {
    const result = await wordpress.plan(
      target.credentials,
      recommendation.targetUrl,
      recommendation.proposal,
      adapterOptions(recommendation),
    );
    return result.ok
      ? {
          ok: true,
          mode: result.mode,
          kind: result.kind,
          changes: result.changes,
        }
      : { ok: false, reason: result.reason };
  }

  const result = await woocommerce.plan(
    target.credentials,
    recommendation.targetUrl,
    recommendation.proposal,
    adapterOptions(recommendation),
  );
  return result.ok
    ? { ok: true, mode: result.mode, kind: "product", changes: result.changes }
    : { ok: false, reason: result.reason };
}

type AppliedPublish = {
  mode: "create" | "update";
  kind: "product" | "post" | "page";
  externalId: string;
  name: string;
  applied: PublishChange[];
  revisionHint: string;
};

async function applyPublish(
  target: PublishTarget,
  recommendation: Recommendation,
): Promise<
  { ok: true; result: AppliedPublish } | { ok: false; reason: string }
> {
  if (target.adapter === "wordpress") {
    const result = await wordpress.publish(
      target.credentials,
      recommendation.targetUrl,
      recommendation.proposal,
      adapterOptions(recommendation),
    );
    if (!result.ok) return result;
    return {
      ok: true,
      result: {
        mode: result.mode,
        kind: result.target.kind,
        externalId: `${result.target.kind}/${result.target.id}`,
        name: result.target.title,
        applied: result.applied,
        revisionHint: result.revisionHint,
      },
    };
  }

  // The store decides whether this is a create or an update — see the adapter.
  const result = await woocommerce.publish(
    target.credentials,
    recommendation.targetUrl,
    recommendation.proposal,
    adapterOptions(recommendation),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    result: {
      mode: result.mode,
      kind: "product",
      externalId: `product/${result.target.id}`,
      name: result.target.name,
      applied: result.applied,
      revisionHint: result.revisionHint,
    },
  };
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
  if (!recommendation)
    throw new AppError("NOT_FOUND", "Recommendation not found.");

  // The human gate, re-checked at the moment of writing rather than trusted
  // from whoever called this.
  if (!isExecutable(recommendation.status)) {
    throw new AppError(
      "CONFLICT",
      `Only an approved recommendation can be published; this one is ${recommendation.status}.`,
    );
  }

  const target = await loadPublishTarget(projectId, recommendation.targetUrl);
  if ("error" in target) return { ok: false, reason: target.error };

  await OptimizeRepository.updateRecommendation(recommendationId, projectId, {
    status: "running",
    execution: { channel: "wp_rest" },
  });

  const outcome = await applyPublish(target, recommendation);

  if (!outcome.ok) {
    await OptimizeRepository.updateRecommendation(recommendationId, projectId, {
      status: "failed",
      execution: { channel: "wp_rest", dryRunOk: false, error: outcome.reason },
    });
    await OptimizeRepository.addJobEvent({
      id: crypto.randomUUID(),
      recommendationId,
      eventType: "publish_failed",
      actor: actorKey,
      detail: { reason: outcome.reason },
    });
    await alertPublishResult({
      recommendationId,
      projectId,
      targetUrl: recommendation.targetUrl,
      ok: false,
      reason: outcome.reason,
      attemptKey: crypto.randomUUID(),
    });
    return { ok: false, reason: outcome.reason };
  }

  const { result } = outcome;
  await OptimizeRepository.updateRecommendation(recommendationId, projectId, {
    status: "succeeded",
    execution: {
      channel: "wp_rest",
      dryRunOk: true,
      externalJobId: result.externalId,
    },
  });
  await OptimizeRepository.addJobEvent({
    id: crypto.randomUUID(),
    recommendationId,
    eventType: "published",
    actor: actorKey,
    detail: {
      target: result.externalId,
      name: result.name,
      mode: result.mode,
      fields: result.applied.map((change) => change.field),
      // The previous values, kept so a bad publish can be undone by hand —
      // neither WooCommerce nor Rank Math keeps revision history for meta.
      previous: result.applied.map((change) => ({
        field: change.field,
        before: change.before,
      })),
      revisionHint: result.revisionHint,
    },
  });
  await alertPublishResult({
    recommendationId,
    projectId,
    targetUrl: recommendation.targetUrl,
    ok: true,
    attemptKey: crypto.randomUUID(),
  });

  return {
    ok: true,
    mode: result.mode,
    kind: result.kind,
    changes: result.applied,
  };
}
