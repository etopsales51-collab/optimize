import { env } from "cloudflare:workers";
import { AppError } from "@/server/lib/errors";
import type { ArticleImage, OptimizeProposal } from "@/shared/optimize";

/**
 * Article images kept by the app, in R2 under `optimize-images/<project>/<id>`.
 *
 * An agent's image generator usually hands back a link that expires within
 * hours, long before staff approve and publish. So every image is copied in
 * when the recommendation is written, and the preview and the publish both
 * read the app's copy.
 *
 * Raster types only. SVG can carry script, and nothing here needs it.
 */

const PREFIX = "optimize-images/";
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export function imageExtension(contentType: string): string {
  return ALLOWED_TYPES[contentType] ?? "img";
}

function objectKey(projectId: string, assetId: string): string {
  return `${PREFIX}${projectId}/${assetId}`;
}

function normalizeType(contentType: string | null): string | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return type in ALLOWED_TYPES ? type : null;
}

export async function storeImage(input: {
  projectId: string;
  bytes: ArrayBuffer;
  contentType: string | null;
}): Promise<{ assetId: string; contentType: string }> {
  const contentType = normalizeType(input.contentType);
  if (!contentType) {
    throw new AppError("VALIDATION_ERROR", "Images must be PNG, JPEG, WebP, GIF or AVIF.");
  }
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_BYTES) {
    throw new AppError("VALIDATION_ERROR", "Images must be between 1 byte and 8 MB.");
  }
  const assetId = crypto.randomUUID();
  await env.R2.put(objectKey(input.projectId, assetId), input.bytes, {
    httpMetadata: { contentType },
  });
  return { assetId, contentType };
}

export async function loadImage(
  projectId: string,
  assetId: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const object = await env.R2.get(objectKey(projectId, assetId));
  if (!object) return null;
  return {
    bytes: await object.arrayBuffer(),
    contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
  };
}

/** Copy an image from a URL into the app. */
export async function importImageFromUrl(
  projectId: string,
  url: string,
): Promise<{ assetId: string; contentType: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("VALIDATION_ERROR", `Could not download the image at ${url}.`);
  }
  if (!response.ok) {
    throw new AppError("VALIDATION_ERROR", `The image at ${url} returned ${response.status}.`);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    throw new AppError("VALIDATION_ERROR", `The image at ${url} is larger than 8 MB.`);
  }
  return storeImage({
    projectId,
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type"),
  });
}

/**
 * Give every image that has a source URL but no stored copy an app copy.
 * Images already stored (a revision resending what it read back) are left as
 * they are. A failure names the slot, so the agent can fix that one image.
 */
export async function storeProposalImages(
  projectId: string,
  proposal: OptimizeProposal,
): Promise<OptimizeProposal> {
  if (!proposal.images?.length) return proposal;
  const images: ArticleImage[] = [];
  for (const image of proposal.images) {
    if (image.assetId || !image.url) {
      images.push(image);
      continue;
    }
    try {
      const stored = await importImageFromUrl(projectId, image.url);
      images.push({ ...image, assetId: stored.assetId });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Could not store it.";
      throw new AppError("VALIDATION_ERROR", `Image slot "${image.slotId}": ${reason}`);
    }
  }
  return { ...proposal, images };
}
