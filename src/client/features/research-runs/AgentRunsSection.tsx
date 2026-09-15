import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { listResearchRuns } from "@/serverFunctions/researchRuns";
import {
  RESEARCH_RUN_PAGE_PATHS,
  type ResearchRunPage,
} from "@/shared/researchRuns";

/**
 * Research an agent did over MCP, shown beside a page's Recent searches.
 *
 * Recent searches are the signed-in person's own list; agent runs belong to
 * the whole project, so they are listed separately. Opening one navigates with the same
 * URL params a person would have typed, and the page reads the agent's cached
 * result while it is still fresh. Renders nothing until there is a run, so a
 * page with no agent activity looks exactly as it did.
 */

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

export function AgentRunsSection({
  projectId,
  page,
}: {
  projectId: string;
  page: ResearchRunPage;
}) {
  const runs = useQuery({
    queryKey: ["research-runs", projectId, page],
    queryFn: () => listResearchRuns({ data: { projectId, page } }),
    staleTime: 30_000,
  });

  if (!runs.data || runs.data.length === 0) return null;

  return (
    <section className="rounded-2xl border border-base-300 bg-base-100 p-5 md:p-6">
      <div className="mb-1 flex items-center gap-2">
        <Bot className="size-4 text-base-content/45" />
        <span className="text-sm text-base-content/60">
          Agent runs · research done over MCP
        </span>
      </div>
      <p className="mb-4 text-xs text-base-content/45">
        Opens from the agent&rsquo;s cached result while it is fresh; an older
        run is fetched again and uses credits.
      </p>

      <div className="grid gap-2">
        {runs.data.map((run) => (
          <Link
            key={run.id}
            to={RESEARCH_RUN_PAGE_PATHS[run.page]}
            params={{ projectId }}
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- stored params were built for this exact route by researchRunsFromToolCall
            search={run.search as never}
            className="flex items-center justify-between gap-3 rounded-lg border border-base-300 bg-base-100 p-2 hover:bg-base-200/60"
          >
            <span className="min-w-0 truncate text-sm">{run.target}</span>
            <span className="shrink-0 text-xs text-base-content/40">
              {run.actorLabel} · {timeAgo(run.createdAt)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
