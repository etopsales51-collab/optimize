import {
  OPTIMIZE_STATUS_LABELS,
  OPTIMIZE_TYPE_LABELS,
  type EvidenceRef,
  type OptimizePriority,
  type OptimizeStatus,
  type OptimizeType,
} from "@/shared/optimize";

/**
 * Shared chips for the Optimize list and detail views.
 *
 * Colour carries meaning here: staff scan this list for what needs them, so
 * "needs review" and "changes requested" are the only two that draw the eye.
 * Everything settled is deliberately grey.
 */

const STATUS_CLASS: Record<OptimizeStatus, string> = {
  draft: "badge-ghost",
  pending_approval: "badge-warning",
  changes_requested: "badge-info",
  approved: "badge-success",
  running: "badge-primary",
  succeeded: "badge-ghost",
  failed: "badge-error",
  cancelled: "badge-ghost",
  dismissed: "badge-ghost",
};

export function StatusBadge({ status }: { status: OptimizeStatus }) {
  return (
    <span className={`badge badge-sm ${STATUS_CLASS[status]}`}>
      {OPTIMIZE_STATUS_LABELS[status]}
    </span>
  );
}

// P0 is the only priority worth interrupting someone for.
const PRIORITY_CLASS: Record<OptimizePriority, string> = {
  p0: "text-error font-semibold",
  p1: "text-warning font-medium",
  p2: "text-base-content/60",
  p3: "text-base-content/40",
};

export function PriorityLabel({ priority }: { priority: OptimizePriority }) {
  return (
    <span className={`text-xs uppercase ${PRIORITY_CLASS[priority]}`}>
      {priority}
    </span>
  );
}

export function TypeBadge({ type }: { type: OptimizeType }) {
  return (
    <span className="badge badge-sm badge-outline">
      {OPTIMIZE_TYPE_LABELS[type]}
    </span>
  );
}

const SOURCE_LABELS: Record<EvidenceRef["source"], string> = {
  site_audit: "Site Audit",
  rank_tracking: "Rank Tracking",
  gsc_striking_distance: "Striking distance",
  brand_lookup: "Brand Lookup",
  backlinks: "Backlinks",
  competitor: "Competitor",
  cannibalization: "Cannibalization",
};

/**
 * Which modules the agent actually read to reach this conclusion. Deduped: ten
 * striking-distance rows are one reason, not ten chips.
 */
export function SourceChips({ evidence }: { evidence: EvidenceRef[] }) {
  const sources = [...new Set(evidence.map((row) => row.source))];
  if (sources.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {sources.map((source) => (
        <span
          key={source}
          className="badge badge-xs border-base-300 bg-base-200 text-base-content/70"
        >
          {SOURCE_LABELS[source]}
        </span>
      ))}
    </div>
  );
}
