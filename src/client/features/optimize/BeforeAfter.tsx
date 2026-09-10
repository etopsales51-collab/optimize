import { Check, Copy, ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { OptimizeProposal } from "@/shared/optimize";

/**
 * The Before → After view.
 *
 * The point of this screen is that a person can judge a proposal without
 * reading JSON, so unchanged fields are omitted entirely rather than shown as
 * identical pairs — what's on screen is exactly what would change.
 *
 * Proposed copy may contain simple HTML, and it is rendered so staff see the
 * shape of the page. That markup was sanitized on write (previewSanitizer.ts),
 * on the way IN to the database, so nothing here trusts the agent at render
 * time. Fields shown as plain text (title, meta, h1) are never rendered as
 * HTML — React escapes them.
 */

function FieldDiff({
  label,
  before,
  after,
}: {
  label: string;
  before?: string;
  after?: string;
}) {
  if (after === undefined) return null;
  const unchanged = (before ?? "") === after;

  return (
    <div className="border-t border-base-300 pt-3 first:border-0 first:pt-0">
      <p className="text-xs font-medium uppercase tracking-wide text-base-content/50">
        {label}
      </p>
      {unchanged ? (
        <p className="mt-1 text-sm text-base-content/60">
          Unchanged &mdash; {after || <em>empty</em>}
        </p>
      ) : (
        <div className="mt-1 grid gap-2 md:grid-cols-2">
          <div className="rounded-md border border-base-300 bg-base-200/60 p-2">
            <p className="text-[11px] uppercase tracking-wide text-base-content/40">
              Before
            </p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-base-content/70">
              {before ? before : <em className="text-base-content/40">empty</em>}
            </p>
          </div>
          <div className="rounded-md border border-success/40 bg-success/5 p-2">
            <p className="text-[11px] uppercase tracking-wide text-success">
              After
            </p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">
              {after}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const SECTION_ACTION_LABEL = {
  add: "Add section",
  rewrite: "Rewrite section",
  remove: "Remove section",
  keep: "Keep as is",
} as const;

const SECTION_ACTION_CLASS = {
  add: "badge-success",
  rewrite: "badge-warning",
  remove: "badge-error",
  keep: "badge-ghost",
} as const;

export function BeforeAfter({
  proposal,
  previewHtml,
}: {
  proposal: OptimizeProposal;
  previewHtml?: string | null;
}) {
  const sections = proposal.sections ?? [];
  const links = proposal.internalLinks ?? [];
  const attachments = proposal.attachments ?? [];
  const hasMeta = proposal.title || proposal.metaDescription || proposal.h1;

  return (
    <div className="space-y-6">
      {hasMeta ? (
        <section className="rounded-lg border border-base-300 bg-base-100 p-4">
          <h3 className="text-sm font-semibold">Page metadata</h3>
          <div className="mt-3 space-y-3">
            <FieldDiff
              label="Title"
              before={proposal.title?.before}
              after={proposal.title?.after}
            />
            <FieldDiff
              label="Meta description"
              before={proposal.metaDescription?.before}
              after={proposal.metaDescription?.after}
            />
            <FieldDiff
              label="H1"
              before={proposal.h1?.before}
              after={proposal.h1?.after}
            />
          </div>
        </section>
      ) : null}

      {sections.length ? (
        <section className="rounded-lg border border-base-300 bg-base-100 p-4">
          <h3 className="text-sm font-semibold">
            Content changes ({sections.length})
          </h3>
          <div className="mt-3 space-y-4">
            {sections.map((section, index) => (
              <div
                key={`${section.heading}-${index}`}
                className="border-t border-base-300 pt-3 first:border-0 first:pt-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`badge badge-sm ${SECTION_ACTION_CLASS[section.action]}`}
                  >
                    {SECTION_ACTION_LABEL[section.action]}
                  </span>
                  <p className="font-medium">{section.heading}</p>
                </div>

                {section.before ? (
                  <div className="mt-2 rounded-md border border-base-300 bg-base-200/60 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-base-content/40">
                      Before
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-base-content/70">
                      {section.before}
                    </p>
                  </div>
                ) : null}

                {section.after ? (
                  <div className="mt-2 rounded-md border border-success/40 bg-success/5 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-success">
                      After
                    </p>
                    {/* Sanitized on write; see previewSanitizer.ts. */}
                    <div
                      className="prose prose-sm mt-1 max-w-none"
                      dangerouslySetInnerHTML={{ __html: section.after }}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {links.length ? (
        <section className="rounded-lg border border-base-300 bg-base-100 p-4">
          <h3 className="text-sm font-semibold">Internal links</h3>
          <ul className="mt-3 space-y-1.5 text-sm">
            {links.map((link, index) => (
              <li key={`${link.toUrl}-${index}`} className="flex gap-2">
                <span
                  className={`badge badge-xs ${
                    link.action === "add" ? "badge-success" : "badge-error"
                  }`}
                >
                  {link.action}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{link.anchor}</span>
                  <span className="text-base-content/50"> &rarr; </span>
                  <span className="break-all text-base-content/70">
                    {link.toUrl}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {previewHtml ? (
        <section className="rounded-lg border border-base-300 bg-base-100 p-4">
          <h3 className="text-sm font-semibold">Rendered preview</h3>
          <p className="mt-1 text-xs text-base-content/55">
            How the proposed section reads on the page.
          </p>
          <div
            className="prose prose-sm mt-3 max-w-none rounded-md border border-base-300 bg-base-200/40 p-3"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </section>
      ) : null}

      {attachments.length ? (
        <section className="rounded-lg border border-base-300 bg-base-100 p-4">
          <h3 className="text-sm font-semibold">
            {attachments.length === 1 ? "Catalog" : "Catalogs & documents"}
          </h3>
          <p className="mt-1 text-xs text-base-content/55">
            Manufacturer documents for this product. Upload to the media library
            when publishing is not doing it for you.
          </p>
          <ul className="mt-3 space-y-2">
            {attachments.map((attachment, index) => (
              <AttachmentRow
                key={`${attachment.url}-${index}`}
                attachment={attachment}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {proposal.notes ? (
        <section className="rounded-lg border border-dashed border-base-300 bg-base-200/40 p-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-base-content/70">
              Staff only
            </h3>
            <span className="badge badge-ghost badge-xs">never published</span>
          </div>
          <p className="mt-1 text-xs text-base-content/50">
            The agent&rsquo;s working notes: what it could not verify, where
            sources disagree, what it left out. Nothing here reaches the site.
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-base-content/70">
            {proposal.notes}
          </p>
        </section>
      ) : null}
    </div>
  );
}

const ATTACHMENT_KIND_LABEL = {
  catalog: "Catalog",
  datasheet: "Datasheet",
  manual: "Manual",
  certificate: "Certificate",
} as const;

function AttachmentRow({
  attachment,
}: {
  attachment: NonNullable<OptimizeProposal["attachments"]>[number];
}) {
  const [copied, setCopied] = useState(false);
  const isPdf = /\.pdf(\?|#|$)/i.test(attachment.url);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(attachment.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — select the URL and copy it by hand.");
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-base-300 bg-base-200/40 p-2">
      <FileText className="size-4 shrink-0 text-base-content/60" />
      <span className="badge badge-sm badge-outline">
        {ATTACHMENT_KIND_LABEL[attachment.kind]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {attachment.label}
        </span>
        <span className="block truncate text-xs text-base-content/50">
          {attachment.url}
        </span>
      </span>
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="btn btn-xs"
      >
        <ExternalLink className="size-3.5" />
        {isPdf ? "Open PDF" : "Open"}
      </a>
      <button type="button" className="btn btn-xs" onClick={copy}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy URL"}
      </button>
    </li>
  );
}
