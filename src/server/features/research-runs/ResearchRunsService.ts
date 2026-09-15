import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { researchRuns } from "@/db/schema";
import {
  researchRunsFromToolCall,
  type ResearchRunDraft,
  type ResearchRunPage,
} from "@/shared/researchRuns";

/**
 * Record and read research agents did over MCP. See shared/researchRuns.ts for
 * why this exists and how a run reopens on its page.
 */

/** Keep the log readable: older runs are rarely reopened and cost nothing to drop. */
const LIST_LIMIT_DEFAULT = 15;

async function insertRuns(input: {
  projectId: string;
  actorLabel: string;
  drafts: ResearchRunDraft[];
}) {
  if (input.drafts.length === 0) return;
  const createdAt = new Date().toISOString();
  await db.insert(researchRuns).values(
    input.drafts.map((draft) => ({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      page: draft.page,
      toolName: draft.toolName,
      source: "mcp" as const,
      actorLabel: input.actorLabel,
      target: draft.target.slice(0, 500),
      searchJson: JSON.stringify(draft.search),
      createdAt,
    })),
  );
}

/**
 * Log the runs a successful MCP tool call produced. Never throws: the research
 * already succeeded and the agent has its result; a logging failure must not
 * turn that into an error.
 */
export async function recordResearchToolCall(input: {
  toolName: string;
  args: unknown;
  actorLabel: string;
}) {
  const args =
    input.args && typeof input.args === "object"
      ? (input.args as Record<string, unknown>)
      : {};
  const projectId = typeof args.projectId === "string" ? args.projectId : null;
  if (!projectId) return;

  const drafts = researchRunsFromToolCall(input.toolName, args);
  if (drafts.length === 0) return;

  try {
    await insertRuns({ projectId, actorLabel: input.actorLabel, drafts });
  } catch (error) {
    console.error(`[research-runs] could not record ${input.toolName}:`, error);
  }
}

export async function listResearchRuns(input: {
  projectId: string;
  page?: ResearchRunPage;
  limit?: number;
}) {
  const rows = await db
    .select()
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.projectId, input.projectId),
        input.page ? eq(researchRuns.page, input.page) : undefined,
      ),
    )
    .orderBy(desc(researchRuns.createdAt))
    .limit(input.limit ?? LIST_LIMIT_DEFAULT);

  return rows.map((row) => {
    let search: ResearchRunDraft["search"] = {};
    try {
      search = JSON.parse(row.searchJson) as ResearchRunDraft["search"];
    } catch {
      search = {};
    }
    return {
      id: row.id,
      page: row.page,
      toolName: row.toolName,
      source: row.source,
      actorLabel: row.actorLabel,
      target: row.target,
      search,
      createdAt: row.createdAt,
    };
  });
}

export const ResearchRunsService = {
  recordResearchToolCall,
  listResearchRuns,
} as const;
