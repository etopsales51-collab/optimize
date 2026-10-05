import { z } from "zod";

export const PAGE_SCHEMA_VERSION = "optimize-page-v1" as const;

export const pageImageSchema = z.object({
  id: z.number().int().positive(),
  url: z.string().url(),
  alt: z.string().trim().min(3),
  caption: z.string().max(500).default(""),
});

export const pageSectionSchema = z.object({
  heading: z.string().max(200).default(""),
  body: z.string().max(20_000).default(""),
  image: pageImageSchema.nullable().default(null),
});

export const faqItemSchema = z.object({
  question: z.string().max(300).default(""),
  answer: z.string().max(5_000).default(""),
});

export const optimizePageDocumentSchema = z.object({
  schemaVersion: z.literal(PAGE_SCHEMA_VERSION),
  title: z.string().trim().min(1).max(250),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  seoTitle: z.string().max(250).default(""),
  metaDescription: z.string().max(500).default(""),
  focusKeyword: z.string().max(200).default(""),
  h1: z.string().max(250).default(""),
  intro: z.string().max(10_000).default(""),
  heroImage: pageImageSchema.nullable().default(null),
  summary: z.array(z.string().max(500)).max(5).default(["", "", ""]),
  sections: z.array(pageSectionSchema).length(6),
  table: z.object({
    heading: z.string().max(200).default(""),
    columns: z.array(z.string().max(200)).max(6).default([]),
    rows: z
      .array(z.array(z.string().max(2_000)).max(6))
      .max(30)
      .default([]),
  }),
  faqHeading: z.string().max(200).default(""),
  faqs: z.array(faqItemSchema).max(20).default([]),
  cta: z.string().max(5_000).default(""),
});

export type OptimizePageDocument = z.infer<typeof optimizePageDocumentSchema>;
export type PageImage = z.infer<typeof pageImageSchema>;

export function emptyOptimizePageDocument(): OptimizePageDocument {
  return {
    schemaVersion: PAGE_SCHEMA_VERSION,
    title: "New page",
    slug: "new-page",
    seoTitle: "",
    metaDescription: "",
    focusKeyword: "",
    h1: "",
    intro: "",
    heroImage: null,
    summary: ["", "", ""],
    sections: Array.from({ length: 6 }, () => ({
      heading: "",
      body: "",
      image: null,
    })),
    table: { heading: "", columns: [], rows: [] },
    faqHeading: "",
    faqs: [],
    cta: "",
  };
}

export type PageDraftSummary = {
  id: string;
  title: string;
  slug: string;
  wpPageId: number | null;
  status: "draft" | "publish";
  updatedAt: string;
};

export type PageDraftView = PageDraftSummary & {
  document: OptimizePageDocument;
  remoteModifiedGmt: string | null;
  previewUrl: string | null;
  savedRenderedHtml: string | null;
};

export type WordpressMediaItem = {
  id: number;
  sourceUrl: string;
  alt: string;
  caption: string;
  title: string;
};
