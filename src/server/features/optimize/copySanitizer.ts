import type { OptimizeProposal } from "@/shared/optimize";
import { sanitizePreviewHtml } from "./previewSanitizer";

/**
 * Keep the agent's working notes out of the customer's product page.
 *
 * An agent writing a proposal is doing two jobs at once: producing copy a
 * shopper will read, and telling staff what it was unsure about. Those went
 * into the same fields, so live products ended up carrying lines like
 * "X (portfolio row; marketing still says Outdoor — verify…)" and a footer
 * reading "Verbatim nested table… No images in this brief."
 *
 * The split this enforces:
 *
 *   publishable  title, metaDescription, h1, sections[].after, previewHtml
 *   staff-only   proposal.notes, comments, evidence labels
 *
 * Staff-only fields are never written to WordPress — the publish mapper reads
 * none of them — and are not touched here. Publishable fields are stripped of
 * process language on WRITE, so the stored proposal is already the customer's
 * version and no later renderer or mapper can leak the working notes.
 *
 * Stripping, not rejecting. A 400 sends the agent round again and staff wait;
 * removing the aside keeps the useful copy and records exactly what went, so a
 * wrong removal is visible rather than silent.
 *
 * What this CANNOT do is turn manufacturer marketing into facts. "With our Live
 * Finger Detection Technology, it can distinguish…" is well-formed English with
 * no process markers in it; only the agent can be told to write lean copy, and
 * that instruction lives in the MCP tool description.
 */

/**
 * Phrases that mean an agent is talking to staff rather than to a customer.
 *
 * Deliberately multi-word. A bare "verify" would eat legitimate copy on these
 * stores — "verify your identity" is what a fingerprint terminal does — so the
 * markers carry enough context to be unambiguous. Everything removed is
 * reported, which is the check on the two loosest entries here, "conflict" and
 * the operator's own name.
 */
const PROCESS_MARKERS = [
  "verbatim",
  "portfolio row",
  "verify before",
  "no images in this brief",
  "in this brief",
  "staff:",
  "out of scope",
  "conflict",
  "flag for",
  "walid",
  "marketing still says",
  "todo",
  "fixme",
  "agent note",
  "could not verify",
  "cannot confirm",
  "unverified",
  "needs verification",
];

/** A parenthetical this long inside a spec cell is an essay, not a unit. */
const CELL_ASIDE_MAX = 40;

export type CopyRemoval = {
  /** Where it came from, e.g. "sections[2].after" — shown to staff and agent. */
  field: string;
  text: string;
};

function hasMarker(value: string): boolean {
  const lower = value.toLowerCase();
  return PROCESS_MARKERS.some((marker) => lower.includes(marker));
}

function collapse(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}

/**
 * Strip process language from one run of text.
 *
 * `cell` marks a table cell, where the bar is higher: a spec cell holds a bare
 * value ("X", "IP65", "20,000") and any long aside is noise even when it
 * carries no marker.
 */
function stripRun(
  value: string,
  options: { cell: boolean },
  removed: string[],
): string {
  let text = value;

  // 1. Bracketed asides: "(portfolio row; …)" and "[verify before publish]".
  text = text.replace(/\s*[([]([^()[\]]*)[)\]]/g, (match, inner: string) => {
    const drop =
      hasMarker(inner) || (options.cell && inner.trim().length > CELL_ASIDE_MAX);
    if (drop) removed.push(match.trim());
    return drop ? "" : match;
  });

  // 2. Trailing dash asides: "X — verify before publishing". The head is real
  //    copy, so only the segments after the dash are candidates.
  const segments = text.split(/\s+[—–]\s+/);
  if (segments.length > 1) {
    const kept = segments.filter((segment, index) => {
      if (index === 0 || !hasMarker(segment)) return true;
      removed.push(segment.trim());
      return false;
    });
    text = kept.join(" — ");
  }

  // 3. Whole sentences that are process talk: "Verbatim nested table…"
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? (text ? [text] : []);
  if (sentences.length > 0) {
    text = sentences
      .filter((sentence) => {
        if (!hasMarker(sentence)) return true;
        removed.push(sentence.trim());
        return false;
      })
      .join("");
  }

  return collapse(text);
}

/** Text only — used for title, metaDescription and h1, which carry no markup. */
function stripPlain(value: string, field: string, removals: CopyRemoval[]): string {
  const removed: string[] = [];
  // These land in <title> and <meta>, where a tag is never wanted.
  const text = stripRun(value.replace(/<[^>]*>/g, " "), { cell: false }, removed);
  for (const item of removed) removals.push({ field, text: item });
  return text;
}

/** Remove blocks the stripping emptied, so no bare bullet or heading is left. */
function dropEmptyBlocks(html: string): string {
  let previous = "";
  let current = html;
  while (current !== previous) {
    previous = current;
    current = current.replace(
      /<(p|li|h[1-6]|blockquote|figcaption|caption)>\s*<\/\1>/g,
      "",
    );
  }
  return current;
}

/**
 * Strip process language from markup.
 *
 * Runs the allowlist sanitizer FIRST, so what this walks is markup this app
 * generated: well formed, known tags, escaped text. That is what makes the
 * text-run pass below safe to do without a second parse.
 */
export function sanitizeSectionHtml(
  input: string,
  field: string,
  removals: CopyRemoval[],
): string {
  const safe = sanitizePreviewHtml(input);
  if (!safe) return "";

  const removed: string[] = [];
  let cellDepth = 0;

  const stripped = safe.replace(
    /(<[^>]*>)|([^<]+)/g,
    (_match, tag: string | undefined, text: string | undefined) => {
      if (tag !== undefined) {
        if (/^<(td|th)\b/i.test(tag)) cellDepth += 1;
        else if (/^<\/(td|th)>/i.test(tag)) cellDepth = Math.max(0, cellDepth - 1);
        return tag;
      }
      return stripRun(text ?? "", { cell: cellDepth > 0 }, removed);
    },
  );

  for (const item of removed) removals.push({ field, text: item });
  return dropEmptyBlocks(stripped);
}

/**
 * Return the proposal a customer should see, plus everything taken out of it.
 *
 * `notes` is passed through untouched: it is where the verification the agent
 * owes staff belongs, and nothing publishes it.
 */
export function sanitizeProposalCopy(proposal: OptimizeProposal): {
  proposal: OptimizeProposal;
  removals: CopyRemoval[];
} {
  const removals: CopyRemoval[] = [];

  const plainPair = (
    pair: { before: string; after: string } | undefined,
    field: string,
  ) =>
    pair === undefined
      ? undefined
      : { before: pair.before, after: stripPlain(pair.after, field, removals) };

  return {
    proposal: {
      ...proposal,
      title: plainPair(proposal.title, "title"),
      metaDescription: plainPair(proposal.metaDescription, "metaDescription"),
      h1: plainPair(proposal.h1, "h1"),
      sections: (proposal.sections ?? []).map((section, index) => ({
        ...section,
        heading: stripPlain(section.heading, `sections[${index}].heading`, removals),
        after:
          section.after === undefined
            ? undefined
            : sanitizeSectionHtml(
                section.after,
                `sections[${index}].after`,
                removals,
              ),
      })),
    },
    removals,
  };
}
