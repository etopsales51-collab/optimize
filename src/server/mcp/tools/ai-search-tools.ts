import { z } from "zod";
import { getBrandLookup } from "@/server/features/ai-search/services/brandLookup";
import { explorePrompt } from "@/server/features/ai-search/services/promptExplorer";
import { ResearchRunsService } from "@/server/features/research-runs/ResearchRunsService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { DEFAULT_LOCATION_CODE } from "@/shared/keyword-locations";
import { RESEARCH_RUN_PAGES } from "@/shared/researchRuns";
import { researchScopeSchema } from "@/shared/researchScope";
import {
  BRAND_LOOKUP_MAX_INPUT_LENGTH,
  PROMPT_EXPLORER_MAX_PROMPT_LENGTH,
  PROMPT_EXPLORER_MODELS,
  promptExplorerModelSchema,
  webSearchCountryCodeSchema,
} from "@/types/schemas/ai-search";

/**
 * Brand Lookup and Prompt Explorer over MCP, calling the same services the
 * pages call with the same parameters the pages send. That parity is the point:
 * the service caches by those parameters, so when staff open the run from the
 * page's Agent runs list, the page reads the agent's cached result instead of
 * buying it again. Change a default here only together with the page.
 */

// ---------------------------------------------------------------------------
// run_brand_lookup
// ---------------------------------------------------------------------------

const brandInputSchema = {
  projectId: projectIdSchema,
  query: z
    .string()
    .trim()
    .min(1)
    .max(BRAND_LOOKUP_MAX_INPUT_LENGTH)
    .describe("A brand name ('eTOP') or a domain ('etopme.ae') to look up in AI answers."),
  competitors: z
    .array(z.string().trim().min(1).max(BRAND_LOOKUP_MAX_INPUT_LENGTH))
    .max(5)
    .optional()
    .describe("Up to 5 competitor brands or domains for Share of Voice."),
  scope: researchScopeSchema
    .optional()
    .describe("For domain or URL queries only. Omit to derive it from the query."),
} as const;

type BrandArgs = z.infer<z.ZodObject<typeof brandInputSchema>>;

export const runBrandLookupTool = {
  name: "run_brand_lookup",
  config: {
    title: "Run Brand Lookup",
    description:
      "AI Visibility for a brand or domain: how often ChatGPT and Google AI Overviews mention or cite it, AI search volume, the prompts that surface it, the pages cited, and Share of Voice against up to 5 competitors. Same job as the Brand Lookup page; the run is listed there under Agent runs for staff. Charges credits; cached 24 hours per brand, competitors and scope.",
    inputSchema: brandInputSchema,
    outputSchema: z
      .object({
        query: z.string().optional(),
        hasData: z.boolean().optional(),
        totalMentions: z.number().nullable().optional(),
        totalAiSearchVolume: z.number().nullable().optional(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: BrandArgs, context) => {
    const result = await getBrandLookup(
      {
        projectId: args.projectId,
        query: args.query,
        competitors: args.competitors ?? [],
        scope: args.scope,
        // Exactly what BrandLookupPage sends, so the page reuses this cache.
        locationCode: DEFAULT_LOCATION_CODE,
        languageCode: "en",
      },
      context.billing,
    );

    const lines = [
      `Target: ${result.resolvedTarget} (${result.detectedTargetType})`,
      result.hasData ? null : "No AI visibility data for this target.",
      `Mentions: ${result.totalMentions ?? "?"} · AI search volume: ${result.totalAiSearchVolume ?? "?"}`,
      ...result.perPlatform.map(
        (row) =>
          `- ${row.platform}: ${row.status === "success" ? `${row.mentions ?? "?"} mentions, volume ${row.aiSearchVolume ?? "?"}` : "unavailable"}`,
      ),
      result.shareOfVoice
        ? `Share of Voice: ${result.shareOfVoice.entries
            .map((entry) => `${entry.label} ${entry.sharePct === null ? "?" : `${Math.round(entry.sharePct)}%`}`)
            .join(", ")}`
        : null,
      result.topQueries.length
        ? `Top prompts: ${result.topQueries
            .slice(0, 5)
            .map((row) => `"${row.question}"`)
            .join("; ")}`
        : null,
      result.topPages.length
        ? `Top cited pages: ${result.topPages
            .slice(0, 5)
            .map((row) => row.url)
            .join(", ")}`
        : null,
    ].filter((line): line is string => line !== null);

    return mcpResponse({
      text: lines.join("\n"),
      meta: buildProjectMeta(context, args.projectId, `/p/${args.projectId}/brand-lookup`, {
        q: args.query,
      }),
      structuredContent: result,
    });
  }),
};

// ---------------------------------------------------------------------------
// run_prompt_explorer
// ---------------------------------------------------------------------------

const promptInputSchema = {
  projectId: projectIdSchema,
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(PROMPT_EXPLORER_MAX_PROMPT_LENGTH)
    .describe("The question a buyer would ask an AI assistant."),
  models: z
    .array(promptExplorerModelSchema)
    .min(1)
    .max(4)
    .optional()
    .describe("chat_gpt, claude, gemini, perplexity. Omit for all four, as the page does."),
  highlightBrand: z
    .string()
    .trim()
    .min(1)
    .max(BRAND_LOOKUP_MAX_INPUT_LENGTH)
    .optional()
    .describe("A brand to flag in answers and citations, e.g. 'eTOP'."),
  webSearch: z
    .boolean()
    .optional()
    .describe("Let models search the web. Default true, as on the page."),
  webSearchCountryCode: webSearchCountryCodeSchema
    .optional()
    .describe("Country for the web-search component. Default US, as on the page."),
} as const;

type PromptArgs = z.infer<z.ZodObject<typeof promptInputSchema>>;

export const runPromptExplorerTool = {
  name: "run_prompt_explorer",
  config: {
    title: "Run Prompt Explorer",
    description:
      "Ask ChatGPT, Claude, Gemini and Perplexity the same prompt and compare their answers, citations, fan-out queries and whether a brand is mentioned. Same job as the Prompt Explorer page; the run is listed there under Agent runs for staff. Charges credits per model; each model's answer is cached 7 days.",
    inputSchema: promptInputSchema,
    outputSchema: {
      prompt: z.string(),
      highlightBrand: z.string().nullable(),
      fetchedAt: z.string(),
      results: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    },
    annotations: { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  },
  handler: withMcpProjectAuth(async (args: PromptArgs, context) => {
    const result = await explorePrompt(
      {
        projectId: args.projectId,
        prompt: args.prompt,
        models: args.models ?? [...PROMPT_EXPLORER_MODELS],
        highlightBrand: args.highlightBrand,
        webSearch: args.webSearch ?? true,
        // The page always sends a country (US by default); sending the same
        // value keeps the cache key identical.
        webSearchCountryCode: args.webSearchCountryCode ?? "US",
      },
      context.billing,
    );

    const text = result.results
      .map((row) => {
        if (row.status === "error") return `## ${row.model}\nError: ${row.message}`;
        const brand =
          row.brandMentioned === null
            ? ""
            : ` · ${result.highlightBrand} ${row.brandMentioned ? "mentioned" : "not mentioned"}`;
        const citations = row.citations.length
          ? `\nCitations: ${row.citations.map((c) => c.url).slice(0, 8).join(", ")}`
          : "";
        return `## ${row.model}${row.modelName ? ` (${row.modelName})` : ""}${brand}\n${row.text.slice(0, 1500)}${citations}`;
      })
      .join("\n\n");

    return mcpResponse({
      text,
      meta: buildProjectMeta(context, args.projectId, `/p/${args.projectId}/prompt-explorer`, {
        q: args.prompt,
      }),
      structuredContent: result,
    });
  }),
};

// ---------------------------------------------------------------------------
// list_research_runs
// ---------------------------------------------------------------------------

const listInputSchema = {
  projectId: projectIdSchema,
  page: z
    .enum(RESEARCH_RUN_PAGES)
    .optional()
    .describe("Filter to one Research page: keywords, domain, backlinks, brand_lookup, prompt_explorer."),
  limit: z.number().int().min(1).max(100).optional().describe("Default 20, newest first."),
} as const;

export const listResearchRunsTool = {
  name: "list_research_runs",
  config: {
    title: "List research runs",
    description:
      "Research already done over MCP for this project (keywords, SERP, domain, backlinks, Brand Lookup, Prompt Explorer), newest first, with who ran it. Check this before researching a target again: recent runs are cached, but repeating work wastes a routine. Uses no credits.",
    inputSchema: listInputSchema,
    outputSchema: {
      runs: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof listInputSchema>>, context) => {
      const runs = await ResearchRunsService.listResearchRuns({
        projectId: args.projectId,
        page: args.page,
        limit: args.limit ?? 20,
      });
      return mcpResponse({
        text: runs.length
          ? runs
              .map((run) => `- ${run.createdAt} ${run.page} · ${run.target} (${run.toolName}, ${run.actorLabel})`)
              .join("\n")
          : "No research runs recorded yet.",
        meta: buildProjectMeta(context, args.projectId),
        structuredContent: { runs },
      });
    },
  ),
};
