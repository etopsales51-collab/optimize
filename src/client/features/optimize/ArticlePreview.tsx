import { ImageIcon, X } from "lucide-react";
import type { ReactNode } from "react";
import { buildArticleBodyHtml, hostedImagePath } from "@/shared/articleHtml";
import type { ArticleImage, OptimizeProposal } from "@/shared/optimize";

/**
 * The finished article, as a reader will see it: search snippet, featured
 * image, H1, then the body with its images mounted. Staff approve from here.
 *
 * The body comes from shared/articleHtml.ts, the same builder the WordPress
 * publisher uses, so this is what goes live apart from the theme's styling.
 * Section HTML was sanitized when the agent wrote it; the builder escapes
 * everything it adds.
 */

function imageSource(projectId: string) {
  return (image: ArticleImage) =>
    image.assetId ? hostedImagePath(projectId, image.assetId) : (image.url ?? null);
}

function SlotPlaceholder({ image }: { image: ArticleImage }) {
  return (
    <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-base-300 bg-base-200/60 p-6 text-center">
      <ImageIcon className="size-8 text-base-content/30" />
      <p className="text-sm font-medium text-base-content/60">
        Image slot: {image.slotId}
      </p>
      {image.prompt || image.alt ? (
        <p className="max-w-md text-xs text-base-content/50">
          {image.prompt || image.alt}
        </p>
      ) : null}
    </div>
  );
}

export function ArticlePreviewModal({
  projectId,
  targetUrl,
  proposal,
  onClose,
  actions,
}: {
  projectId: string;
  targetUrl: string;
  proposal: OptimizeProposal;
  onClose: () => void;
  actions?: ReactNode;
}) {
  const source = imageSource(projectId);
  const images = proposal.images ?? [];
  const hero = images.find((image) => image.role === "hero");
  const heroSrc = hero ? source(hero) : null;
  const emptySlots = images.filter((image) => !source(image)).length;
  const bodyHtml = buildArticleBodyHtml(proposal, {
    imageSource: source,
    placeholders: true,
  });
  const seoTitle = proposal.title?.after?.trim();
  const metaDescription = proposal.metaDescription?.after?.trim();
  const addedLinks = proposal.internalLinks.filter((link) => link.action === "add");

  return (
    <div className="modal modal-open" role="dialog" aria-label="Article preview">
      <div className="modal-box flex h-[92vh] w-11/12 max-w-4xl flex-col p-0">
        <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3">
          <p className="text-sm font-semibold">Article preview</p>
          <span className="text-xs text-base-content/50">
            {images.length
              ? `${images.length} image${images.length === 1 ? "" : "s"}${emptySlots ? `, ${emptySlots} still empty` : ""}`
              : "No images"}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square ml-auto"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-10">
          {seoTitle || metaDescription ? (
            <div className="mx-auto mb-8 max-w-2xl rounded-lg border border-base-300 bg-base-100 p-4">
              <p className="text-[11px] uppercase tracking-wide text-base-content/40">
                In search results
              </p>
              <p className="mt-1 break-all text-xs text-success">{targetUrl}</p>
              {seoTitle ? (
                <p className="mt-0.5 text-lg leading-snug text-info">{seoTitle}</p>
              ) : null}
              {metaDescription ? (
                <p className="mt-1 text-sm text-base-content/70">{metaDescription}</p>
              ) : null}
            </div>
          ) : null}

          <article className="mx-auto max-w-2xl">
            {hero ? (
              <figure className="mb-6">
                {heroSrc ? (
                  <img
                    src={heroSrc}
                    alt={hero.alt}
                    className="w-full rounded-lg object-cover"
                  />
                ) : (
                  <SlotPlaceholder image={hero} />
                )}
                {hero.caption ? (
                  <figcaption className="mt-2 text-center text-sm text-base-content/60">
                    {hero.caption}
                  </figcaption>
                ) : null}
              </figure>
            ) : null}

            <h1 className="text-3xl font-bold leading-tight">
              {proposal.h1?.after?.trim() || "(No H1 yet)"}
            </h1>

            {bodyHtml ? (
              <div
                className="prose prose-lg mt-6 max-w-none [&_figcaption]:text-center [&_figure]:my-6 [&_img]:rounded-lg [&_.article-image-slot-box]:flex [&_.article-image-slot-box]:aspect-[16/9] [&_.article-image-slot-box]:flex-col [&_.article-image-slot-box]:items-center [&_.article-image-slot-box]:justify-center [&_.article-image-slot-box]:gap-1 [&_.article-image-slot-box]:rounded-lg [&_.article-image-slot-box]:border-2 [&_.article-image-slot-box]:border-dashed [&_.article-image-slot-box]:border-base-300 [&_.article-image-slot-box]:bg-base-200/60 [&_.article-image-slot-box]:p-6 [&_.article-image-slot-box]:text-center [&_.article-image-slot-box]:text-sm [&_.wp-block-gallery]:grid [&_.wp-block-gallery]:grid-cols-2 [&_.wp-block-gallery]:gap-3"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            ) : (
              <p className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
                There is no body yet. Request changes so the agent writes the
                full post.
              </p>
            )}

            {addedLinks.length ? (
              <aside className="mt-8 rounded-lg border border-base-300 p-4 text-sm">
                <p className="font-medium">Internal links in this post</p>
                <ul className="mt-2 space-y-1">
                  {addedLinks.map((link, index) => (
                    <li key={`${link.toUrl}-${index}`} className="break-all text-base-content/70">
                      <span className="font-medium text-base-content">{link.anchor}</span>{" "}
                      &rarr; {link.toUrl}
                    </li>
                  ))}
                </ul>
              </aside>
            ) : null}
          </article>
        </div>

        {actions ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-base-300 px-4 py-3">
            {actions}
          </div>
        ) : null}
      </div>
      <button type="button" className="modal-backdrop" onClick={onClose} aria-label="Close" />
    </div>
  );
}
