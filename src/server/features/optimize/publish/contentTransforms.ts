import type { OptimizeProposal } from "@/shared/optimize";

export type LinkResult = {
  anchor: string;
  toUrl: string;
  action: "added" | "removed" | "skipped";
  reason?: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function path(value: string): string {
  try {
    return new URL(value).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return value.replace(/\/+$/, "") || "/";
  }
}

function protectedRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const pattern =
    /<!--[\s\S]*?-->|<(a|h[1-6]|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]+>/gi;
  for (const match of html.matchAll(pattern)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function inside(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function existingHref(html: string, toUrl: string): boolean {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].some(
    (match) => path(match[1]) === path(toUrl),
  );
}

export function applyInternalLinks(
  html: string,
  links: OptimizeProposal["internalLinks"],
  siteUrl: string,
  fixAttributes = true,
): { html: string; results: LinkResult[] } {
  let output = html;
  const results: LinkResult[] = [];
  for (const link of links) {
    if (link.action === "remove") {
      let removed = 0;
      output = output.replace(
        /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
        (whole, attrs: string, body: string) => {
          const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
          const visible = body.replace(/<[^>]+>/g, "").trim();
          if (
            href &&
            path(href) === path(link.toUrl) &&
            visible.toLowerCase() === link.anchor.trim().toLowerCase()
          ) {
            removed += 1;
            return body;
          }
          return whole;
        },
      );
      results.push({
        ...link,
        action: removed ? "removed" : "skipped",
        ...(removed ? {} : { reason: "link not found" }),
      });
      continue;
    }
    if (existingHref(output, link.toUrl)) {
      results.push({ ...link, action: "skipped", reason: "already linked" });
      continue;
    }
    const ranges = protectedRanges(output);
    const matcher = new RegExp(`\\b${escapeRegExp(link.anchor)}\\b`, "i");
    const match = matcher.exec(output);
    if (!match || inside(match.index, ranges)) {
      let candidate = match;
      while (candidate && inside(candidate.index, ranges)) {
        matcher.lastIndex = candidate.index + candidate[0].length;
        candidate = matcher.exec(output);
      }
      if (!candidate) {
        results.push({
          ...link,
          action: "skipped",
          reason: "anchor not found",
        });
        continue;
      }
      output = `${output.slice(0, candidate.index)}<a href="${link.toUrl}">${candidate[0]}</a>${output.slice(candidate.index + candidate[0].length)}`;
    } else {
      output = `${output.slice(0, match.index)}<a href="${link.toUrl}">${match[0]}</a>${output.slice(match.index + match[0].length)}`;
    }
    results.push({ ...link, action: "added" });
  }

  if (fixAttributes) {
    let origin = "";
    try {
      origin = new URL(siteUrl).origin;
    } catch {
      /* leave unchanged */
    }
    output = output.replace(/<a\b([^>]*)>/gi, (whole, attrs: string) => {
      const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
      if (!href) return whole;
      let internal = href.startsWith("/");
      try {
        internal ||= Boolean(origin) && new URL(href, origin).origin === origin;
      } catch {
        return whole;
      }
      if (!internal) return whole;
      let next = attrs.replace(/\s+target=["']_blank["']/gi, "");
      next = next.replace(/\s+rel=["']([^"']*)["']/gi, (_all, rel: string) => {
        const values = rel
          .split(/\s+/)
          .filter((value) => value && value.toLowerCase() !== "nofollow");
        return values.length ? ` rel="${values.join(" ")}"` : "";
      });
      return `<a${next}>`;
    });
  }
  return { html: output, results };
}

export function applySectionEdits(
  html: string,
  sections: OptimizeProposal["sections"],
  frontPage = false,
): string {
  let output = html;
  for (const section of sections) {
    const heading = section.heading.trim();
    if (!heading || section.action === "keep") continue;
    const expression = new RegExp(
      `(<h([2-6])[^>]*>\\s*${escapeRegExp(heading)}\\s*</h\\2>)([\\s\\S]*?)(?=<h[2-6]\\b|$)`,
      "i",
    );
    const match = expression.exec(output);
    if (section.action === "remove") {
      if (match) output = output.replace(expression, "");
    } else if (section.action === "rewrite") {
      if (match && section.after !== undefined)
        output = output.replace(expression, `$1\n${section.after}`);
    } else if (
      section.action === "add" &&
      !frontPage &&
      section.after?.trim()
    ) {
      output += `\n\n<h2>${heading}</h2>\n${section.after}`;
    }
  }
  return output;
}
