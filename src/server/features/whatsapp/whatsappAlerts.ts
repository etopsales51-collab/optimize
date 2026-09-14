import { AuditRepository } from "@/server/features/audit/repositories/AuditRepository";
import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { AUDIT_ISSUE_TYPES, type IssueSeverity } from "@/shared/audit-issues";
import { publicBaseUrl } from "./twilio";
import { WhatsappService, type WhatsappAlertType } from "./WhatsappService";
import { describeDrop, findKeywordDrops, formatAlert } from "./whatsappRules";

/**
 * The events that reach the team's WhatsApp, and nothing else.
 *
 *   keyword_drop     a rank check found keywords that fell meaningfully
 *   audit_warning    a site audit finished with critical issues
 *   approval_needed  an agent submitted work that waits for a person
 *   published        approved work went live
 *   publish_failed   approved work could not be published
 *
 * Each is one message per event, and each is fire-and-forget: the rank check,
 * audit or publish that raised it has already succeeded and must not fail, or
 * slow down meaningfully, because a notification could not be sent.
 */

async function safely(label: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    console.error(`[whatsapp] ${label} alert failed:`, error);
  }
}

async function link(path: string) {
  const base = await publicBaseUrl();
  return base ? `${base}${path}` : null;
}

async function announce(input: {
  projectId: string;
  alertType: WhatsappAlertType;
  dedupeKey: string;
  headline: string;
  lines?: string[];
  path: string;
}) {
  const project = await WhatsappService.projectForAlert(input.projectId);
  if (!project) return;
  await WhatsappService.notifyTeam({
    organizationId: project.organizationId,
    projectId: input.projectId,
    alertType: input.alertType,
    dedupeKey: input.dedupeKey,
    body: formatAlert({
      projectName: project.name,
      headline: input.headline,
      lines: input.lines,
      link: await link(input.path),
    }),
  });
}

export function alertKeywordDrops(input: {
  runId: string;
  configId: string;
  projectId: string;
}) {
  return safely("keyword drop", async () => {
    const previous = await RankTrackingRepository.getPreviousCompletedRun(
      input.configId,
      input.runId,
    );
    // A first check has nothing to drop from.
    if (!previous) return;

    const [before, after] = await Promise.all([
      RankTrackingRepository.getSnapshotsForRun(previous.id),
      RankTrackingRepository.getSnapshotsForRun(input.runId),
    ]);
    const drops = findKeywordDrops(before, after);
    if (drops.length === 0) return;

    await announce({
      projectId: input.projectId,
      alertType: "keyword_drop",
      dedupeKey: `keyword_drop:${input.runId}`,
      headline: `${drops.length} keyword${drops.length === 1 ? "" : "s"} dropped`,
      lines: drops.map(describeDrop),
      path: `/p/${input.projectId}/rank-tracking`,
    });
  });
}

export function alertAuditFinished(input: {
  auditId: string;
  projectId: string;
}) {
  return safely("audit", async () => {
    const issues = await AuditRepository.getIssuesForAudit(input.auditId, {
      severity: "critical",
    });
    // Warnings and notices wait for someone to open the audit; only critical
    // issues interrupt a phone.
    if (issues.length === 0) return;

    const counts = new Map<string, number>();
    for (const issue of issues) {
      counts.set(issue.issueType, (counts.get(issue.issueType) ?? 0) + 1);
    }
    const lines = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => {
        const descriptor = (
          AUDIT_ISSUE_TYPES as Record<string, { title: string; severity: IssueSeverity }>
        )[type];
        return `${descriptor?.title ?? type.replace(/[-_]/g, " ")}: ${count}`;
      });

    await announce({
      projectId: input.projectId,
      alertType: "audit_warning",
      dedupeKey: `audit:${input.auditId}`,
      headline: `Site audit found ${issues.length} critical issue${issues.length === 1 ? "" : "s"}`,
      lines,
      path: `/p/${input.projectId}/audit`,
    });
  });
}

export function alertApprovalNeeded(input: {
  recommendationId: string;
  projectId: string;
  typeLabel: string;
  targetUrl: string;
  submittedBy: string;
  /** Set for a resubmission, so a revised proposal is announced again. */
  revisionKey?: string;
}) {
  return safely("approval", async () => {
    await announce({
      projectId: input.projectId,
      alertType: "approval_needed",
      dedupeKey: `approval:${input.recommendationId}:${input.revisionKey ?? "first"}`,
      headline: `Needs your approval: ${input.typeLabel}`,
      lines: [input.targetUrl, `Proposed by ${input.submittedBy}`],
      path: `/p/${input.projectId}/optimize/${input.recommendationId}`,
    });
  });
}

export function alertPublishResult(input: {
  recommendationId: string;
  projectId: string;
  targetUrl: string;
  ok: boolean;
  reason?: string;
  /** Distinguishes a retry's result from the first attempt's. */
  attemptKey: string;
}) {
  return safely("publish", async () => {
    await announce({
      projectId: input.projectId,
      alertType: input.ok ? "published" : "publish_failed",
      dedupeKey: `publish:${input.recommendationId}:${input.attemptKey}`,
      headline: input.ok ? "Published" : "Publishing failed",
      lines: input.ok
        ? [input.targetUrl]
        : [input.targetUrl, input.reason ?? "No reason given."],
      path: `/p/${input.projectId}/optimize/${input.recommendationId}`,
    });
  });
}
