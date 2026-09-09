import { Parser } from "htmlparser2";

/**
 * Sanitize agent-authored preview markup before it is stored or rendered.
 *
 * The Before/After preview exists so staff can see a proposal as a page rather
 * than as JSON. That means rendering HTML written by an external agent inside
 * an authenticated staff session — a direct script-injection path to whoever is
 * about to click Approve. So the markup is sanitized on WRITE, and only the
 * sanitized form is stored: a later change to the renderer cannot reintroduce
 * the hole, and a compromised agent cannot sit in the database waiting for one.
 *
 * Strict allowlist, not a blocklist. Anything not named here is dropped, which
 * fails closed as HTML gains new elements and attributes. Uses htmlparser2,
 * already a runtime dependency for the crawler, rather than regexes — regex
 * HTML sanitizers are defeated by malformed markup, which is exactly what an
 * attacker sends.
 */

// Structural and text elements a content proposal legitimately needs.
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "a",
  "span",
  "div",
  "section",
  "article",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "caption",
  "figure",
  "figcaption",
  "img",
  "small",
  "sup",
  "sub",
  "dl",
  "dt",
  "dd",
]);

// Void elements must not be given a closing tag.
const VOID_TAGS = new Set(["br", "hr", "img"]);

// Per-tag attribute allowlist. Deliberately tiny: no style (CSS can exfiltrate
// and can cover the page), no class (could borrow app styling to fake UI), no
// id (can break the host document), and no event handlers of any kind.
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  td: new Set(["colspan", "rowspan"]),
};

// Schemes permitted in href/src. `javascript:` and `data:` are the two that
// turn a link or an image into script execution.
const SAFE_URL = /^(https?:\/\/|mailto:|\/|#)/i;

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function isSafeUrl(value: string): boolean {
  // Strip control characters first: "java\tscript:" and friends are parsed as
  // a scheme by browsers but slip past a naive prefix test.
  const cleaned = value.replace(/[\u0000-\u0020]/g, "").toLowerCase();
  if (cleaned.startsWith("javascript:") || cleaned.startsWith("data:")) {
    return false;
  }
  return SAFE_URL.test(value.trim());
}

export function sanitizePreviewHtml(input: string | null | undefined): string {
  if (!input) return "";

  const out: string[] = [];
  // Tags we opened and must close, so unbalanced agent markup cannot leak into
  // the surrounding page.
  const openStack: string[] = [];
  // Depth inside a dropped subtree (script/style/etc): text within is discarded
  // rather than emitted as visible text.
  let suppressDepth = 0;

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const tag = name.toLowerCase();

        if (suppressDepth > 0) {
          suppressDepth += 1;
          return;
        }

        if (!ALLOWED_TAGS.has(tag)) {
          // script/style/iframe/svg and anything unknown: drop the element AND
          // its contents.
          suppressDepth = 1;
          return;
        }

        const allowed = ALLOWED_ATTRS[tag];
        const parts: string[] = [tag];

        if (allowed) {
          for (const [rawKey, rawValue] of Object.entries(attribs)) {
            const key = rawKey.toLowerCase();
            if (!allowed.has(key)) continue;
            const value = String(rawValue ?? "");
            if ((key === "href" || key === "src") && !isSafeUrl(value)) {
              continue;
            }
            parts.push(`${key}="${escapeAttr(value)}"`);
          }
        }

        if (tag === "a") {
          // Agent-supplied links point off-site; never hand them window.opener.
          parts.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
        }

        out.push(`<${parts.join(" ")}>`);
        if (!VOID_TAGS.has(tag)) openStack.push(tag);
      },

      ontext(text) {
        if (suppressDepth > 0) return;
        out.push(escapeText(text));
      },

      onclosetag(name) {
        const tag = name.toLowerCase();

        if (suppressDepth > 0) {
          suppressDepth -= 1;
          return;
        }

        if (VOID_TAGS.has(tag) || !ALLOWED_TAGS.has(tag)) return;

        // Only close a tag we actually opened, and unwind to it so crossed tags
        // cannot escape the fragment.
        const index = openStack.lastIndexOf(tag);
        if (index === -1) return;
        for (let i = openStack.length - 1; i >= index; i -= 1) {
          out.push(`</${openStack[i]}>`);
        }
        openStack.length = index;
      },
    },
    // Agent output is a fragment, and decodeEntities makes "&lt;script&gt;"
    // resolve to text we then re-escape, rather than to a live tag.
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );

  parser.write(input);
  parser.end();

  // Close anything the agent left open.
  for (let i = openStack.length - 1; i >= 0; i -= 1) {
    out.push(`</${openStack[i]}>`);
  }

  return out.join("");
}
