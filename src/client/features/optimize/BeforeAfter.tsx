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

      {proposal.notes ? (
        <section className="rounded-lg border border-base-300 bg-base-100 p-4">
          <h3 className="text-sm font-semibold">Why this</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-base-content/75">
            {proposal.notes}
          </p>
        </section>
      ) : null}
    </div>
  );
}
