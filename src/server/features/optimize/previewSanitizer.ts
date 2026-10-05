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
  "details",
  "summary",
]);

// Void elements must not be given a closing tag.
const VOID_TAGS = new Set(["br", "hr", "img"]);

// Per-tag attribute allowlist. Deliberately tiny: no style (CSS can exfiltrate
// and can cover the page), no id (can break the host document), and no event
// handlers. Only publisher-owned etop-/nv- classes are kept below.
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  td: new Set(["colspan", "rowspan"]),
};

const CLASS_TAGS = new Set([
  "article",
  "details",
  "div",
  "ol",
  "p",
  "section",
  "span",
  "summary",
  "table",
  "ul",
]);

const SAFE_CLASS = /^(?:etop-|nv-|optimize-|wp-block-)[A-Za-z0-9_-]*$/;

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

function siteHost(siteUrl: string | null | undefined): string | null {
  if (!siteUrl) return null;
  try {
    return new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function linkKind(
  href: string,
  baseHost: string | null,
): "internal" | "external" | "other" {
  const value = href.trim();
  if (value.startsWith("/") || value.startsWith("#")) return "internal";
  if (!/^https?:\/\//i.test(value)) return "other";
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return baseHost && host === baseHost ? "internal" : "external";
  } catch {
    return "other";
  }
}

function safeClassValue(value: string): string {
  return value
    .split(/\s+/)
    .filter((name) => SAFE_CLASS.test(name))
    .join(" ");
}

function safeTarget(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return ["_blank", "_self", "_parent", "_top"].includes(normalized)
    ? normalized
    : null;
}

function safeRelTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => /^[a-z][a-z0-9_-]*$/.test(token));
}

export function sanitizePreviewHtml(
  input: string | null | undefined,
  options: { siteUrl?: string | null } = {},
): string {
  if (!input) return "";

  const out: string[] = [];
  const baseHost = siteHost(options.siteUrl);
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
            if (tag === "a" && (key === "target" || key === "rel")) continue;
            const value = String(rawValue ?? "");
            if ((key === "href" || key === "src") && !isSafeUrl(value)) {
              continue;
            }
            parts.push(`${key}="${escapeAttr(value)}"`);
          }
        }

        if (CLASS_TAGS.has(tag)) {
          const className = safeClassValue(String(attribs.class ?? ""));
          if (className) parts.push(`class="${escapeAttr(className)}"`);
        }

        if (tag === "a" && typeof attribs.href === "string") {
          const kind = linkKind(attribs.href, baseHost);
          const sourceTarget = safeTarget(String(attribs.target ?? ""));
          const rel = safeRelTokens(String(attribs.rel ?? ""));

          if (kind === "external") {
            parts.push(`target="${sourceTarget ?? "_blank"}"`);
            for (const required of ["noopener", "noreferrer"]) {
              if (!rel.includes(required)) rel.push(required);
            }
          } else if (kind === "other" && sourceTarget) {
            parts.push(`target="${sourceTarget}"`);
          }

          const keptRel =
            kind === "internal"
              ? rel.filter((token) => token !== "nofollow")
              : rel;
          if (keptRel.length > 0) {
            parts.push(`rel="${escapeAttr([...new Set(keptRel)].join(" "))}"`);
          }
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
    {
      decodeEntities: true,
      lowerCaseTags: true,
      lowerCaseAttributeNames: true,
    },
  );

  parser.write(input);
  parser.end();

  // Close anything the agent left open.
  for (let i = openStack.length - 1; i >= 0; i -= 1) {
    out.push(`</${openStack[i]}>`);
  }

  return out.join("");
}
