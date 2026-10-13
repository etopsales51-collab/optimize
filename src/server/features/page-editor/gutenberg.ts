import { Parser } from "htmlparser2";
import { parse } from "@wordpress/block-serialization-default-parser";
import type { OptimizePageDocument, PageImage } from "@/shared/pageEditor";
import { sanitizePreviewHtml } from "@/server/features/optimize/previewSanitizer";

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (value: string) => esc(value).replace(/"/g, "&quot;");
const attrs = (anchor: string) =>
  JSON.stringify({ anchor, metadata: { name: anchor } });

function block(name: string, attributes: object, html: string): string {
  const encoded = Object.keys(attributes).length
    ? ` ${JSON.stringify(attributes)}`
    : "";
  return `<!-- wp:${name}${encoded} -->\n${html}\n<!-- /wp:${name} -->`;
}

function group(anchor: string, children: string, className = ""): string {
  const classes = ["wp-block-group", className].filter(Boolean).join(" ");
  return `<!-- wp:group ${attrs(anchor)} -->\n<div class="${classes}" id="${anchor}">${children}</div>\n<!-- /wp:group -->`;
}

function imageBlock(anchor: string, image: PageImage): string {
  const caption = image.caption.trim()
    ? `<figcaption class="wp-element-caption">${esc(image.caption.trim())}</figcaption>`
    : "";
  return group(
    anchor,
    block(
      "image",
      {
        id: image.id,
        sizeSlug: "full",
        linkDestination: "none",
        metadata: { name: `${anchor}-image` },
      },
      `<figure class="wp-block-image size-full"><img src="${attr(image.url)}" alt="${attr(image.alt)}" class="wp-image-${image.id}"/>${caption}</figure>`,
    ),
    "optimize-image-slot",
  );
}

function richParagraph(anchor: string, html: string): string {
  return block("html", { metadata: { name: `${anchor}-content` } }, html);
}

export type PageValidation = { valid: boolean; errors: string[] };

function hasHeading(html: string): boolean {
  let found = false;
  const parser = new Parser({
    onopentag(name) {
      if (/^h[1-6]$/.test(name)) found = true;
    },
  });
  parser.end(html);
  return found;
}

export function validatePageDocument(
  document: OptimizePageDocument,
): PageValidation {
  const errors: string[] = [];
  if (!document.h1.trim()) errors.push("H1 is required.");
  const summary = document.summary.filter((item) => item.trim());
  if (summary.length < 3 || summary.length > 5)
    errors.push("Summary must contain 3–5 completed points.");
  const headings = document.sections
    .map((section) => section.heading.trim())
    .filter(Boolean);
  if (
    new Set(headings.map((heading) => heading.toLocaleLowerCase())).size !==
    headings.length
  ) {
    errors.push("Section H2 headings must be unique.");
  }
  document.sections.forEach((section, index) => {
    const used = section.heading.trim() || section.body.trim() || section.image;
    if (index < 4 && (!section.heading.trim() || !section.body.trim())) {
      errors.push(`Section ${index + 1} needs an H2 and body.`);
    } else if (used && (!section.heading.trim() || !section.body.trim())) {
      errors.push(`Optional section ${index + 1} needs both an H2 and body.`);
    }
    if (hasHeading(section.body))
      errors.push(`Section ${index + 1} body cannot contain headings.`);
  });
  for (const [label, image] of [
    ["Hero", document.heroImage],
    ...document.sections.map((s, i) => [`Section ${i + 1}`, s.image] as const),
  ] as const) {
    if (image && (!URL.canParse(image.url) || image.alt.trim().length < 3))
      errors.push(`${label} image needs a valid URL and meaningful alt text.`);
  }
  const usedFaqs = document.faqs.filter(
    (faq) => faq.question.trim() || faq.answer.trim(),
  );
  if (usedFaqs.some((faq) => !faq.question.trim() || !faq.answer.trim()))
    errors.push(
      "Every FAQ question needs an answer and every answer needs a question.",
    );
  if (usedFaqs.length && !document.faqHeading.trim())
    errors.push("FAQ section heading is required when FAQs are present.");
  if (document.table.rows.length) {
    if (
      document.table.columns.length < 2 ||
      document.table.columns.some((cell) => !cell.trim())
    )
      errors.push("Comparison table needs at least two named columns.");
    if (
      document.table.rows.some(
        (row) =>
          row.length !== document.table.columns.length ||
          row.some((cell) => !cell.trim()),
      )
    )
      errors.push("Every comparison table row must complete every column.");
  }
  return { valid: errors.length === 0, errors };
}

export function serializePageDocument(
  document: OptimizePageDocument,
  siteUrl?: string,
): string {
  const safe = (html: string) => sanitizePreviewHtml(html, { siteUrl });
  const parts: string[] = [];
  parts.push(
    group(
      "slot-h1",
      block(
        "heading",
        { level: 1, metadata: { name: "slot-h1-heading" } },
        `<h1 class="wp-block-heading">${esc(document.h1.trim())}</h1>`,
      ),
    ),
  );
  parts.push(
    group("slot-intro", richParagraph("slot-intro", safe(document.intro))),
  );
  if (document.heroImage)
    parts.push(imageBlock("slot-hero-image", document.heroImage));
  const summary = document.summary.filter((item) => item.trim());
  parts.push(
    group(
      "slot-summary",
      block(
        "list",
        { metadata: { name: "slot-summary-list" } },
        `<ul class="wp-block-list">${summary.map((item) => `<li>${esc(item.trim())}</li>`).join("")}</ul>`,
      ),
      "optimize-summary",
    ),
  );
  document.sections.forEach((section, index) => {
    if (!section.heading.trim() && !section.body.trim() && !section.image)
      return;
    const number = index + 1;
    const anchor = `slot-section-${number}`;
    const children = [
      group(
        `${anchor}-heading`,
        block(
          "heading",
          { level: 2, metadata: { name: `${anchor}-heading-block` } },
          `<h2 class="wp-block-heading">${esc(section.heading.trim())}</h2>`,
        ),
      ),
      group(
        `${anchor}-body`,
        richParagraph(`${anchor}-body`, safe(section.body)),
      ),
      section.image ? imageBlock(`${anchor}-image`, section.image) : "",
    ].join("");
    parts.push(group(anchor, children, "optimize-section"));
  });
  if (document.table.rows.length) {
    const header = `<thead><tr>${document.table.columns.map((cell) => `<th>${esc(cell)}</th>`).join("")}</tr></thead>`;
    const body = `<tbody>${document.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    parts.push(
      group(
        "slot-table",
        `${document.table.heading.trim() ? block("heading", { level: 2, metadata: { name: "slot-table-heading" } }, `<h2 class="wp-block-heading">${esc(document.table.heading.trim())}</h2>`) : ""}${block("table", { metadata: { name: "slot-table-data" } }, `<figure class="wp-block-table"><table>${header}${body}</table></figure>`)}`,
        "optimize-table",
      ),
    );
  }
  const faqs = document.faqs.filter(
    (faq) => faq.question.trim() && faq.answer.trim(),
  );
  if (faqs.length) {
    parts.push(
      group(
        "slot-faq",
        block(
          "heading",
          { level: 2, metadata: { name: "slot-faq-heading" } },
          `<h2 class="wp-block-heading">${esc(document.faqHeading.trim())}</h2>`,
        ) +
          faqs
            .map((faq, index) =>
              group(
                `slot-faq-item-${index + 1}`,
                block(
                  "heading",
                  {
                    level: 3,
                    metadata: { name: `slot-faq-question-${index + 1}` },
                  },
                  `<h3 class="wp-block-heading">${esc(faq.question.trim())}</h3>`,
                ) +
                  richParagraph(
                    `slot-faq-answer-${index + 1}`,
                    safe(faq.answer),
                  ),
              ),
            )
            .join(""),
        "optimize-faq",
      ),
    );
  }
  if (document.cta.trim())
    parts.push(
      group(
        "slot-cta",
        richParagraph("slot-cta", safe(document.cta)),
        "optimize-cta",
      ),
    );
  const serialized = parts.join("\n\n");
  const parsed = parse(serialized);
  const parsedBlocks = parsed.filter((item) => item.blockName);
  if (
    parsedBlocks.length !== parts.length ||
    parsedBlocks.some((item) => item.blockName !== "core/group")
  )
    throw new Error("Gutenberg could not parse the serialized page blocks.");
  const anchors = new Set<string>();
  const names = new Set<string>();
  const visit = (items: typeof parsed) => {
    for (const item of items) {
      const anchor =
        typeof item.attrs?.anchor === "string" ? item.attrs.anchor : null;
      const name =
        typeof item.attrs?.metadata?.name === "string"
          ? item.attrs.metadata.name
          : null;
      if (anchor && anchors.has(anchor))
        throw new Error(`Duplicate Gutenberg anchor: ${anchor}`);
      if (name && names.has(name))
        throw new Error(`Duplicate Gutenberg block name: ${name}`);
      if (anchor) anchors.add(anchor);
      if (name) names.add(name);
      visit(item.innerBlocks);
    }
  };
  visit(parsed);
  return serialized;
}

export function countHeadings(html: string): { h1: number; h2: string[] } {
  let h1 = 0;
  const h2: string[] = [];
  let current: string[] | null = null;
  const parser = new Parser({
    onopentag(name) {
      if (name === "h1") h1 += 1;
      if (name === "h2") current = [];
    },
    ontext(text) {
      if (current) current.push(text);
    },
    onclosetag(name) {
      if (name === "h2" && current) {
        h2.push(current.join("").trim());
        current = null;
      }
    },
  });
  parser.end(html);
  return { h1, h2 };
}
