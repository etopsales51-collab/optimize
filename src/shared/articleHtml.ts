import type { ArticleImage, OptimizeProposal } from "@/shared/optimize";

/**
 * The body HTML of an article, with its images mounted. One builder for both
 * the in-app preview and the post WordPress receives, so what staff approve is
 * what goes live.
 *
 * Section HTML was sanitized when the agent wrote it. Everything this file adds
 * (alt text, captions, image URLs, placeholder prompts) is escaped here.
 *
 * The hero image is not part of the body: WordPress shows it as the featured
 * image, and the preview draws it above the H1.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Where an image is served from in the app, once the server has stored it. */
export function hostedImagePath(projectId: string, assetId: string): string {
  return `/api/optimize-images/${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`;
}

type ImageSource = (image: ArticleImage) => string | null;

function figure(image: ArticleImage, src: string | null, placeholders: boolean): string {
  const caption = image.caption?.trim();
  const captionHtml = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : "";
  if (src) {
    return `<figure class="wp-block-image size-large"><img src="${escapeHtml(src)}" alt="${escapeHtml(image.alt)}" loading="lazy" />${captionHtml}</figure>`;
  }
  if (!placeholders) return "";
  const prompt = image.prompt?.trim() || image.alt || "Image to come";
  return `<figure class="article-image-slot" data-slot="${escapeHtml(image.slotId)}"><div class="article-image-slot-box"><strong>Image slot: ${escapeHtml(image.slotId)}</strong><span>${escapeHtml(prompt)}</span></div>${captionHtml}</figure>`;
}

export function buildArticleBodyHtml(
  proposal: Pick<OptimizeProposal, "sections" | "images">,
  options: { imageSource: ImageSource; placeholders: boolean },
): string {
  const sections = proposal.sections.filter(
    (section) => section.action !== "remove" && section.after?.trim(),
  );
  const images = proposal.images ?? [];
  const inline = images.filter((image) => image.role === "inline");
  const gallery = images.filter((image) => image.role === "gallery");
  const lastIndex = sections.length - 1;

  const parts: string[] = [];
  sections.forEach((section, index) => {
    parts.push(
      section.heading
        ? `<h2>${escapeHtml(section.heading)}</h2>\n${section.after}`
        : (section.after ?? ""),
    );
    for (const image of inline) {
      const at = Math.min(image.afterSection ?? lastIndex, lastIndex);
      if (at === index) parts.push(figure(image, options.imageSource(image), options.placeholders));
    }
  });

  const galleryFigures = gallery
    .map((image) => figure(image, options.imageSource(image), options.placeholders))
    .filter(Boolean);
  if (galleryFigures.length > 0) {
    parts.push(`<figure class="wp-block-gallery has-nested-images">${galleryFigures.join("")}</figure>`);
  }

  return parts.filter(Boolean).join("\n\n");
}
