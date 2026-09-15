import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ResearchHistoryService } from "@/server/features/research-runs/ResearchHistoryService";
import { ResearchRunsService } from "@/server/features/research-runs/ResearchRunsService";
import {
  RESEARCH_HISTORY_LIST_KEYS,
  RESEARCH_RUN_PAGES,
} from "@/shared/researchRuns";
import { requireProjectContext } from "@/serverFunctions/middleware";

/** Research agents did over MCP for this project, for a Research page's Agent runs list. */
export const listResearchRuns = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    z.object({
      projectId: z.string().min(1),
      page: z.enum(RESEARCH_RUN_PAGES),
    }),
  )
  .handler(async ({ data, context }) =>
    ResearchRunsService.listResearchRuns({
      projectId: context.projectId,
      page: data.page,
    }),
  );

const historyListSchema = z.object({
  projectId: z.string().min(1),
  listKey: z.enum(RESEARCH_HISTORY_LIST_KEYS),
});

/**
 * The signed-in person's recent searches for one Research page. Always the
 * caller's own list in a project they can access — neither id comes from the
 * client unchecked.
 */
export const getResearchHistoryList = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(historyListSchema)
  .handler(async ({ data, context }) => ({
    itemsJson: await ResearchHistoryService.getHistoryList({
      userId: context.userId,
      projectId: context.projectId,
      listKey: data.listKey,
    }),
  }));

export const saveResearchHistoryList = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(historyListSchema.extend({ itemsJson: z.string().max(64_000) }))
  .handler(async ({ data, context }) => {
    await ResearchHistoryService.saveHistoryList({
      userId: context.userId,
      projectId: context.projectId,
      listKey: data.listKey,
      itemsJson: data.itemsJson,
    });
    return { ok: true };
  });
