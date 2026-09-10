import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ExternalLink,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BeforeAfter } from "@/client/features/optimize/BeforeAfter";
import { CommentThread } from "@/client/features/optimize/CommentThread";
import {
  PriorityLabel,
  StatusBadge,
  TypeBadge,
} from "@/client/features/optimize/OptimizeBadges";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addOptimizeComment,
  approveOptimizeRecommendation,
  dismissOptimizeRecommendation,
  getOptimizeRecommendation,
  previewOptimizePublish,
  publishOptimizeRecommendation,
  requestOptimizeChanges,
  retryOptimizePublish,
} from "@/serverFunctions/optimize";
import { canApprove, canRetryPublish, isExecutable } from "@/shared/optimize";

export const Route = createFileRoute(
  "/_project/p/$projectId/optimize/$recommendationId",
)({
  component: OptimizeDetailPage,
});

const EVIDENCE_SOURCE_LABELS: Record<string, string> = {
  site_audit: "Site Audit",
  rank_tracking: "Rank Tracking",
  gsc_striking_distance: "Striking distance",
  brand_lookup: "Brand Lookup",
  backlinks: "Backlinks",
  competitor: "Competitor",
  cannibalization: "Cannibalization",
};

function OptimizeDetailPage() {
  const { projectId, recommendationId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesBody, setChangesBody] = useState("");

  const queryKey = ["optimize", projectId, recommendationId];

  const { data, isPending, error } = useQuery({
    queryKey,
    queryFn: () =>
      getOptimizeRecommendation({ data: { projectId, id: recommendationId } }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["optimize", projectId] });
  };

  // Agent notes stripped from publishable fields on write, recorded as job
  // events so the removal is visible here rather than silent.
  const copyRemovals = (data?.events ?? []).flatMap((event) => {
    if (event.eventType !== "copy_sanitized") return [];
    try {
      const detail = JSON.parse(event.detailJson) as {
        removed?: Array<{ field: string; text: string }>;
      };
      return detail.removed ?? [];
    } catch {
      return [];
    }
  });

  const commentMutation = useMutation({
    mutationFn: (body: string) =>
      addOptimizeComment({ data: { projectId, id: recommendationId, body } }),
    onSuccess: refresh,
    onError: (err) =>
      toast.error(getStandardErrorMessage(err, "Could not post that comment.")),
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      approveOptimizeRecommendation({
        data: { projectId, id: recommendationId },
      }),
    onSuccess: () => {
      toast.success("Approved");
      refresh();
    },
    onError: (err) =>
      toast.error(getStandardErrorMessage(err, "Could not approve this.")),
  });

  const changesMutation = useMutation({
    mutationFn: (body: string) =>
      requestOptimizeChanges({
        data: { projectId, id: recommendationId, body },
      }),
    onSuccess: () => {
      toast.success("Sent back to the agent");
      setChangesOpen(false);
      setChangesBody("");
      refresh();
    },
    onError: (err) =>
      toast.error(getStandardErrorMessage(err, "Could not request changes.")),
  });

  // Publishing is a second, deliberate action after approval — approving
  // records the decision, this writes to the live site. The preview runs the
  // same dry run the server insists on, so staff see the exact fields first.
  const previewMutation = useMutation({
    mutationFn: () =>
      previewOptimizePublish({ data: { projectId, id: recommendationId } }),
    onError: (err) =>
      toast.error(getStandardErrorMessage(err, "Could not preview publishing.")),
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      publishOptimizeRecommendation({ data: { projectId, id: recommendationId } }),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("Published to the live site");
      } else {
        toast.error(result.reason ?? "Publishing failed");
      }
      refresh();
    },
    onError: (err) =>
      toast.error(getStandardErrorMessage(err, "Publishing failed.")),
  });

  const retryMutation = useMutation({
    mutationFn: () =>
      retryOptimizePublish({ data: { projectId, id: recommendationId } }),
    onSuccess: () => {
      toast.success("Ready to publish again");
      refresh();
    },
    onError: (err) =>
      toast.error(getStandardErrorMessage(err, "Could not reset this.")),
  });

  const dismissMutation = useMutation({
    mutationFn: () =>
      dismissOptimizeRecommendation({
        data: { projectId, id: recommendationId },
      }),
    onSuccess: () => {
      toast.success("Dismissed");
      void navigate({ to: "/p/$projectId/optimize", params: { projectId } });
    },
    onError: (err) =>
      toast.error(getStandardErrorMessage(err, "Could not dismiss this.")),
  });

  if (isPending) {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="mx-auto max-w-4xl space-y-3">
          <div className="h-8 w-56 animate-pulse rounded bg-base-200" />
          <div className="h-40 animate-pulse rounded-lg bg-base-200" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-4 py-6 md:px-6">
        <div className="mx-auto max-w-4xl">
          <p className="text-sm text-error">
            {getStandardErrorMessage(error, "Could not load this item.")}
          </p>
        </div>
      </div>
    );
  }

  const { recommendation, comments } = data;
  const check = recommendation.cannibalizationCheck;
  const approvable = canApprove(recommendation.status);
  const publishable = isExecutable(recommendation.status);
  const retryable = canRetryPublish(recommendation.status);
  const failureReason = recommendation.execution.error;

  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <Link
          to="/p/$projectId/optimize"
          params={{ projectId }}
          className="inline-flex items-center gap-1.5 text-sm text-base-content/60 hover:text-base-content"
        >
          <ArrowLeft className="size-3.5" />
          All recommendations
        </Link>

        <header className="rounded-lg border border-base-300 bg-base-100 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityLabel priority={recommendation.priority} />
            <StatusBadge status={recommendation.status} />
            <TypeBadge type={recommendation.type} />
            <span className="text-xs text-base-content/50">
              by {recommendation.createdByAgent}
            </span>
          </div>

          <h1 className="mt-2 text-xl font-semibold">
            {recommendation.primaryQuery ?? recommendation.targetUrl}
          </h1>

          <a
            href={recommendation.targetUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 break-all text-sm text-base-content/60 hover:text-base-content"
          >
            {recommendation.targetUrl}
            <ExternalLink className="size-3 shrink-0" />
          </a>

          {recommendation.secondaryQueries.length ? (
            <p className="mt-2 text-xs text-base-content/55">
              Also targets: {recommendation.secondaryQueries.join(", ")}
            </p>
          ) : null}
        </header>

        {/* The gate. Approve is the only thing here that can change a live
            site, so it is the only primary button on the page. */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-3">
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1.5"
            disabled={!approvable || approveMutation.isPending}
            onClick={() => approveMutation.mutate()}
          >
            <Check className="size-4" />
            Approve
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!approvable || changesMutation.isPending}
            onClick={() => setChangesOpen(true)}
          >
            Request changes
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm gap-1.5 text-error"
            disabled={dismissMutation.isPending}
            onClick={() => {
              if (window.confirm("Dismiss this recommendation?")) {
                dismissMutation.mutate();
              }
            }}
          >
            <X className="size-4" />
            Dismiss
          </button>

          {retryable ? (
            <button
              type="button"
              className="btn btn-sm gap-1.5"
              disabled={retryMutation.isPending}
              onClick={() => retryMutation.mutate()}
            >
              <RotateCcw className="size-4" />
              {retryMutation.isPending ? "Resetting…" : "Retry publish"}
            </button>
          ) : null}

          <p className="ml-auto text-xs text-base-content/50">
            {approvable
              ? "Approving records your decision. Publishing is a separate step."
              : publishable
                ? "Approved. Publish when you are ready."
                : retryable
                  ? "Publishing failed. Fix the cause, then retry."
                  : `No action available while this is ${recommendation.status.replace("_", " ")}.`}
          </p>
        </div>

        {retryable && failureReason ? (
          <div className="rounded-lg border border-error/40 bg-error/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="size-4" />
              Publishing failed
            </p>
            <p className="mt-1 text-sm text-base-content/80">{failureReason}</p>
            <p className="mt-2 text-xs text-base-content/60">
              The approval still stands. Fix the cause — usually the connection
              in Project settings &rarr; Publishing — then Retry publish.
            </p>
          </div>
        ) : null}

        {copyRemovals.length ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="size-4" />
              Stripped from customer copy ({copyRemovals.length})
            </p>
            <p className="mt-1 text-xs text-base-content/60">
              Agent working notes found in publishable fields were removed
              before this was stored. What you see below is what will publish.
              If something useful went, ask the agent to put it in its notes.
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {copyRemovals.slice(0, 8).map((removal, index) => (
                <li key={`${removal.field}-${index}`} className="flex gap-2">
                  <span className="shrink-0 font-mono text-base-content/50">
                    {removal.field}
                  </span>
                  <span className="text-base-content/80 line-through">
                    {removal.text}
                  </span>
                </li>
              ))}
              {copyRemovals.length > 8 ? (
                <li className="text-base-content/50">
                  …and {copyRemovals.length - 8} more.
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {publishable ? (
          <div className="rounded-lg border border-base-300 bg-base-100 p-4">
            <h3 className="text-sm font-semibold">Publish to the live site</h3>
            <p className="mt-1 text-sm text-base-content/70">
              Updates the product at this URL, or creates it if there is none.
              It writes the SEO title, the meta description and the brand
              category, and takes a draft live. The product name, price, stock
              and images are never changed.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-sm"
                disabled={previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
              >
                {previewMutation.isPending ? "Checking…" : "Check what would change"}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm gap-1.5"
                disabled={publishMutation.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Publish these SEO changes to the live site now?",
                    )
                  ) {
                    publishMutation.mutate();
                  }
                }}
              >
                <Upload className="size-4" />
                {publishMutation.isPending ? "Publishing…" : "Publish now"}
              </button>
            </div>

            {previewMutation.data ? (
              previewMutation.data.ok ? (
                <div className="mt-3 space-y-2 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-base-content/50">
                    {previewMutation.data.mode === "create"
                      ? "Will create a new product"
                      : "Will update the existing product"}
                  </p>
                  {(previewMutation.data.changes ?? []).length === 0 ? (
                    <p className="text-base-content/60">
                      Already up to date — publishing would write nothing.
                    </p>
                  ) : null}
                  <ul className="space-y-2">
                    {(previewMutation.data.changes ?? []).map((change) => (
                      <li
                        key={change.field}
                        className="rounded-md bg-base-200/60 p-2"
                      >
                        <p className="text-xs font-medium uppercase tracking-wide text-base-content/50">
                          {change.label}
                        </p>
                        <p className="mt-0.5 text-base-content/60 line-through">
                          {change.before || "(empty)"}
                        </p>
                        <p className="text-success">{change.after}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-3 text-sm text-warning">
                  {previewMutation.data.reason}
                </p>
              )
            ) : null}
          </div>
        ) : null}

        {check && check.status !== "clear" ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="size-4" />
              {check.status === "merge_recommended"
                ? "Several pages compete for this intent"
                : "An existing page already covers this intent"}
            </p>
            <p className="mt-1 text-sm text-base-content/75">{check.notes}</p>
            {check.overlappingUrls.length ? (
              <ul className="mt-2 space-y-1 text-sm">
                {check.overlappingUrls.map((row) => (
                  <li key={row.url} className="break-all">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="link"
                    >
                      {row.url}
                    </a>
                    {row.score !== undefined ? (
                      <span className="text-base-content/50">
                        {" "}
                        &middot; {Math.round(row.score * 100)}% overlap
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {recommendation.merge ? (
          <section className="rounded-lg border border-base-300 bg-base-100 p-4">
            <h3 className="text-sm font-semibold">Merge plan</h3>
            <p className="mt-2 text-sm">
              <span className="font-medium text-success">Keep</span>{" "}
              <span className="break-all">{recommendation.merge.keepUrl}</span>
            </p>
            <p className="mt-1 text-sm font-medium text-base-content/70">
              Merge in and redirect:
            </p>
            <ul className="mt-1 space-y-0.5 text-sm text-base-content/70">
              {recommendation.merge.mergeFromUrls.map((url) => (
                <li key={url} className="break-all">
                  {url}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {recommendation.evidence.length ? (
          <section className="rounded-lg border border-base-300 bg-base-100 p-4">
            <h3 className="text-sm font-semibold">Why now</h3>
            <ul className="mt-3 space-y-2">
              {recommendation.evidence.map((item, index) => (
                <li key={index} className="flex flex-wrap items-baseline gap-2">
                  <span className="badge badge-xs border-base-300 bg-base-200 text-base-content/70">
                    {EVIDENCE_SOURCE_LABELS[item.source] ?? item.source}
                  </span>
                  <span className="min-w-0 text-sm">
                    {item.label}
                    {item.url ? (
                      <>
                        {" "}
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="link text-xs text-base-content/50"
                        >
                          view
                        </a>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <BeforeAfter
          proposal={recommendation.proposal}
          previewHtml={recommendation.previewHtml}
        />

        <CommentThread
          comments={comments}
          isPosting={commentMutation.isPending}
          onPost={(body) => commentMutation.mutate(body)}
        />
      </div>

      {changesOpen ? (
        <div className="modal modal-open" role="dialog">
          <div className="modal-box">
            <h3 className="text-lg font-semibold">Request changes</h3>
            <p className="mt-1 text-sm text-base-content/70">
              Say what should change. This goes to the agent, which revises the
              proposal and replies in the thread.
            </p>
            <textarea
              autoFocus
              rows={4}
              value={changesBody}
              onChange={(event) => setChangesBody(event.target.value)}
              placeholder="e.g. Keep the H1 as it is, and make the CTA softer."
              className="textarea textarea-bordered mt-3 w-full text-sm"
            />
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setChangesOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!changesBody.trim() || changesMutation.isPending}
                onClick={() => changesMutation.mutate(changesBody.trim())}
              >
                Send to agent
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
