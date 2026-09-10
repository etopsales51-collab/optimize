import { createServerFn } from "@tanstack/react-start";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { autofillProjectContext as runContextAutofill } from "@/server/features/project-context/services/contextAutofill";
import { ProjectContextService } from "@/server/features/project-context/services/ProjectContextService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  getProjectContextSchema,
  updateProjectContextSchema,
} from "@/types/schemas/projectContext";

export const getProjectContext = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getProjectContextSchema)
  .handler(async ({ context }) =>
    ProjectContextService.getProjectContext(context.projectId),
  );

export const updateProjectContext = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(updateProjectContextSchema)
  .handler(async ({ data, context }) =>
    // Everything reaching this entry point is a person editing their own
    // project's memory; SAM and MCP writes go through the same service with
    // their own author.
    ProjectContextService.applyContextUpdates(
      context.projectId,
      data.updates,
      "user",
    ),
  );

/**
 * Read the project's own website and fill the context fields that are still
 * empty. Never touches a field that already has content. Firecrawl is paid,
 * so this sits behind the same standing as changing the team.
 */
export const autofillProjectContext = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getProjectContextSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { member: ["update"] });
    const result = await runContextAutofill({
      projectId: context.projectId,
      domain: (context.project as { domain?: string | null }).domain ?? null,
    });
    return {
      ...result,
      context: await ProjectContextService.getProjectContext(context.projectId),
    };
  });
