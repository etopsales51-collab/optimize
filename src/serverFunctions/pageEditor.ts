import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { optimizePageDocumentSchema } from "@/shared/pageEditor";
import { PageEditorService } from "@/server/features/page-editor/PageEditorService";

const project = z.object({ projectId: z.string().min(1) });
const draft = project.extend({ id: z.string().min(1) });

export const getPageEditorBootstrap = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(project)
  .handler(({ context }) => PageEditorService.getBootstrap(context.projectId));

export const listPageDrafts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(project)
  .handler(({ context }) => PageEditorService.listDrafts(context.projectId));

export const createPageDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    project.extend({
      title: z.string().trim().min(1).max(250),
      slug: z
        .string()
        .trim()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    }),
  )
  .handler(({ data, context }) =>
    PageEditorService.createDraft(context.projectId, data.title, data.slug),
  );

export const getPageDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(draft)
  .handler(({ data, context }) =>
    PageEditorService.loadDraft(context.projectId, data.id),
  );

export const validatePageDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(project.extend({ document: optimizePageDocumentSchema }))
  .handler(({ data }) => PageEditorService.validateDraft(data.document));

export const savePageDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(draft.extend({ document: optimizePageDocumentSchema }))
  .handler(({ data, context }) =>
    PageEditorService.saveDraft(context.projectId, data.id, data.document),
  );

export const publishPageDraft = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(draft)
  .handler(({ data, context }) =>
    PageEditorService.publishDraft(context.projectId, data.id),
  );

export const searchWordpressMedia = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(project.extend({ search: z.string().max(200).default("") }))
  .handler(({ data, context }) =>
    PageEditorService.mediaLibrary(context.projectId, data.search),
  );
