import {
  optimizePageDocumentSchema,
  type OptimizePageDocument,
  emptyOptimizePageDocument,
} from "@/shared/pageEditor";
import { getWordpressPageConnection } from "@/server/features/optimize/publish/publishService";
import * as wordpress from "@/server/features/optimize/publish/wordpressAdapter";
import { sanitizePreviewHtml } from "@/server/features/optimize/previewSanitizer";
import {
  countHeadings,
  serializePageDocument,
  validatePageDocument,
} from "./gutenberg";
import { PageEditorRepository } from "./PageEditorRepository";

function parseDocument(json: string): OptimizePageDocument {
  return optimizePageDocumentSchema.parse(JSON.parse(json));
}

async function connection(projectId: string) {
  const result = await getWordpressPageConnection(projectId);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

export async function getBootstrap(projectId: string) {
  const connected = await connection(projectId);
  const [blueprint, example, hero, sectionImage] = await Promise.all([
    wordpress.readGutenbergSource(connected.credentials, "blocks", 304),
    wordpress.readGutenbergSource(connected.credentials, "pages", 305),
    wordpress.getMedia(connected.credentials, 134),
    wordpress.getMedia(connected.credentials, 112),
  ]);
  if (!blueprint.ok)
    throw new Error(`Optimize Page v1 blueprint: ${blueprint.reason}`);
  if (!example.ok) throw new Error(`Example page: ${example.reason}`);
  return {
    blueprint: { id: blueprint.item.id, title: blueprint.item.title },
    example: { id: example.item.id, title: example.item.title },
    demonstrationMedia: {
      hero: hero.ok ? hero.item : null,
      section2: sectionImage.ok ? sectionImage.item : null,
    },
    faqSchemaPresent:
      /FAQPage/i.test(blueprint.item.contentRaw) ||
      /FAQPage/i.test(example.item.contentRaw),
    publishingEnabled: connected.publishingEnabled,
  };
}

export async function listDrafts(projectId: string) {
  const rows = await PageEditorRepository.list(projectId);
  return rows.map(({ id, title, slug, wpPageId, status, updatedAt }) => ({
    id,
    title,
    slug,
    wpPageId,
    status,
    updatedAt,
  }));
}

export async function createDraft(
  projectId: string,
  title: string,
  slug: string,
) {
  const document = { ...emptyOptimizePageDocument(), title, slug };
  const row = await PageEditorRepository.create(
    projectId,
    title,
    slug,
    JSON.stringify(document),
  );
  if (!row) throw new Error("Could not create the local page draft.");
  return loadDraft(projectId, row.id);
}

export async function loadDraft(projectId: string, id: string) {
  const row = await PageEditorRepository.get(id, projectId);
  if (!row) throw new Error("Page draft was not found.");
  let savedRenderedHtml: string | null = null;
  if (row.wpPageId) {
    const connected = await connection(projectId);
    const remote = await wordpress.readGutenbergSource(
      connected.credentials,
      "pages",
      row.wpPageId,
    );
    if (remote.ok)
      savedRenderedHtml = sanitizePreviewHtml(remote.item.contentRendered, {
        siteUrl: connected.credentials.baseUrl,
      });
  }
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    wpPageId: row.wpPageId,
    status: row.status,
    updatedAt: row.updatedAt,
    document: parseDocument(row.documentJson),
    remoteModifiedGmt: row.remoteModifiedGmt,
    previewUrl: row.previewUrl,
    savedRenderedHtml,
  };
}

export async function validateDraft(document: OptimizePageDocument) {
  const parsed = optimizePageDocumentSchema.parse(document);
  const validation = validatePageDocument(parsed);
  if (!validation.valid)
    return { ...validation, serialized: null, previewHtml: null };
  const serialized = serializePageDocument(parsed);
  const headingResult = countHeadings(serialized);
  if (headingResult.h1 !== 1)
    validation.errors.push(
      `Serialized page contains ${headingResult.h1} H1 headings; exactly one is required.`,
    );
  if (
    new Set(headingResult.h2.map((h) => h.toLocaleLowerCase())).size !==
    headingResult.h2.length
  )
    validation.errors.push("Serialized page contains repeated H2 headings.");
  return {
    valid: validation.errors.length === 0,
    errors: validation.errors,
    serialized,
    previewHtml: sanitizePreviewHtml(serialized),
  };
}

export async function saveDraft(
  projectId: string,
  id: string,
  documentInput: OptimizePageDocument,
) {
  const document = optimizePageDocumentSchema.parse(documentInput);
  const validation = validatePageDocument(document);
  if (!validation.valid)
    return {
      ok: false as const,
      kind: "validation" as const,
      errors: validation.errors,
    };
  const connected = await connection(projectId);
  const row = await PageEditorRepository.get(id, projectId);
  if (!row) throw new Error("Page draft was not found.");
  let wpPageId = row.wpPageId;
  if (wpPageId) {
    const remote = await wordpress.readGutenbergSource(
      connected.credentials,
      "pages",
      wpPageId,
    );
    if (!remote.ok) throw new Error(remote.reason);
    if (
      row.remoteModifiedGmt &&
      remote.item.modifiedGmt !== row.remoteModifiedGmt
    ) {
      return {
        ok: false as const,
        kind: "conflict" as const,
        errors: [
          "This WordPress draft changed after it was opened. Reload before saving so another editor’s changes are not overwritten.",
        ],
      };
    }
  } else {
    const existing = await wordpress.findPageBySlug(
      connected.credentials,
      document.slug,
    );
    if (!existing.ok) throw new Error(existing.reason);
    wpPageId = existing.item?.id ?? null;
  }
  const content = serializePageDocument(
    document,
    connected.credentials.baseUrl,
  );
  const saved = await wordpress.writeGutenbergPage(connected.credentials, {
    id: wpPageId,
    title: document.title,
    slug: document.slug,
    content,
    status: "draft",
  });
  if (!saved.ok) throw new Error(saved.reason);
  const seo = await wordpress.writePageSeoMeta(
    connected.credentials,
    saved.item.id,
    {
      title: document.seoTitle,
      description: document.metaDescription,
      focusKeyword: document.focusKeyword,
    },
  );
  const headings = countHeadings(
    saved.item.contentRaw || saved.item.contentRendered,
  );
  if (headings.h1 !== 1)
    throw new Error(
      `WordPress verification found ${headings.h1} H1 headings instead of one.`,
    );
  await PageEditorRepository.updateLocal(id, projectId, {
    title: document.title,
    slug: document.slug,
    documentJson: JSON.stringify(document),
    wpPageId: saved.item.id,
    remoteModifiedGmt: saved.item.modifiedGmt,
    previewUrl: saved.previewUrl,
    status: "draft",
  });
  return {
    ok: true as const,
    draft: await loadDraft(projectId, id),
    warning: seo.warning,
  };
}

export async function publishDraft(projectId: string, id: string) {
  const connected = await connection(projectId);
  if (!connected.publishingEnabled)
    throw new Error(
      "Publishing is switched off in Project settings → Publishing.",
    );
  const row = await PageEditorRepository.get(id, projectId);
  if (!row?.wpPageId)
    throw new Error("Save this page as a WordPress draft before publishing.");
  const document = parseDocument(row.documentJson);
  const validation = validatePageDocument(document);
  if (!validation.valid)
    return { ok: false as const, errors: validation.errors };
  const remote = await wordpress.readGutenbergSource(
    connected.credentials,
    "pages",
    row.wpPageId,
  );
  if (!remote.ok) throw new Error(remote.reason);
  if (
    row.remoteModifiedGmt &&
    remote.item.modifiedGmt !== row.remoteModifiedGmt
  )
    return {
      ok: false as const,
      errors: [
        "The WordPress draft changed remotely. Reload before publishing.",
      ],
    };
  const result = await wordpress.writeGutenbergPage(connected.credentials, {
    id: row.wpPageId,
    title: document.title,
    slug: document.slug,
    content: serializePageDocument(document, connected.credentials.baseUrl),
    status: "publish",
  });
  if (!result.ok) throw new Error(result.reason);
  await PageEditorRepository.updateLocal(id, projectId, {
    title: document.title,
    slug: document.slug,
    documentJson: row.documentJson,
    wpPageId: result.item.id,
    remoteModifiedGmt: result.item.modifiedGmt,
    previewUrl: result.item.link,
    status: "publish",
  });
  return { ok: true as const, url: result.item.link };
}

export async function mediaLibrary(projectId: string, search: string) {
  const connected = await connection(projectId);
  const result = await wordpress.listMedia(connected.credentials, search);
  if (!result.ok) throw new Error(result.reason);
  return result.items;
}

export const PageEditorService = {
  getBootstrap,
  listDrafts,
  createDraft,
  loadDraft,
  validateDraft,
  saveDraft,
  publishDraft,
  mediaLibrary,
} as const;
