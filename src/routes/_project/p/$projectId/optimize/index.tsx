import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Wand2 } from "lucide-react";
import { useState } from "react";
import {
  PriorityLabel,
  SourceChips,
  StatusBadge,
  TypeBadge,
} from "@/client/features/optimize/OptimizeBadges";
import { listOptimizeRecommendations } from "@/serverFunctions/optimize";
import {
  OPTIMIZE_STATUS_LABELS,
  type OptimizeStatus,
} from "@/shared/optimize";

export const Route = createFileRoute("/_project/p/$projectId/optimize/")({
  component: OptimizePage,
});

// The default view is work that needs a person. Everything settled is one
// click away but does not compete for attention.
const NEEDS_ATTENTION: OptimizeStatus[] = [
  "pending_approval",
  "changes_requested",
];

const FILTERS = [
  { key: "open", label: "Needs review", statuses: NEEDS_ATTENTION },
  { key: "approved", label: "Approved", statuses: ["approved", "running"] },
  { key: "done", label: "Done", statuses: ["succeeded", "failed"] },
  { key: "all", label: "All", statuses: undefined },
] as const;

function OptimizePage() {
  const { projectId } = Route.useParams();
  const [filterKey, setFilterKey] =
    useState<(typeof FILTERS)[number]["key"]>("open");

  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];

  const { data, isLoading } = useQuery({
    queryKey: ["optimize", projectId, filterKey],
    queryFn: () =>
      listOptimizeRecommendations({
        data: {
          projectId,
          statuses: filter.statuses
            ? [...(filter.statuses as readonly OptimizeStatus[])]
            : undefined,
        },
      }),
  });

  const items = data?.items ?? [];

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Optimize</h1>
          <p className="mt-1 text-sm text-base-content/70">
            Recommendations your research agent has proposed for this site.
            Review, discuss, and approve — nothing is published until you do.
          </p>
        </div>

        <div role="tablist" className="tabs tabs-border">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={option.key === filterKey}
              className={`tab ${option.key === filterKey ? "tab-active" : ""}`}
              onClick={() => setFilterKey(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="h-24 animate-pulse rounded-lg bg-base-200"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState needsAttention={filterKey === "open"} />
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  to="/p/$projectId/optimize/$recommendationId"
                  params={{ projectId, recommendationId: item.id }}
                  className="block rounded-lg border border-base-300 bg-base-100 p-4 transition-colors hover:border-base-content/20"
                >
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityLabel priority={item.priority} />
                  <StatusBadge status={item.status} />
                  <TypeBadge type={item.type} />
                  {item.commentCount > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs text-base-content/60">
                      <MessageSquare className="size-3" />
                      {item.commentCount}
                    </span>
                  ) : null}
                </div>

                <p className="mt-2 truncate font-medium">
                  {item.primaryQuery ?? item.targetUrl}
                </p>
                <p className="truncate text-xs text-base-content/55">
                  {item.targetUrl}
                </p>

                  <div className="mt-2">
                    <SourceChips evidence={item.evidence} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {data?.counts?.length ? (
          <p className="text-xs text-base-content/50">
            {data.counts
              .map(
                (row) =>
                  `${row.total} ${OPTIMIZE_STATUS_LABELS[row.status].toLowerCase()}`,
              )
              .join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * An empty Optimize list is the normal state before an agent runs, so this has
 * to read as "working as intended" rather than "something is broken". It also
 * answers the obvious question: staff never fetch these themselves.
 */
function EmptyState({ needsAttention }: { needsAttention: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-base-300 px-6 py-16 text-center">
      <Wand2 className="mx-auto size-6 text-base-content/30" />
      <p className="mt-3 font-medium">
        {needsAttention ? "Nothing waiting on you" : "Nothing here yet"}
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-base-content/60">
        Recommendations appear here on their own when your research agent
        finishes a pass over this site. There is nothing to run or fetch.
      </p>
    </div>
  );
}
