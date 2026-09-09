import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  InviteTeammateModal,
  inviteErrorMessage,
} from "@/client/features/team/InviteTeammateModal";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import { InvitationRow, MemberRow } from "@/client/features/team/TeamTableRows";
import { captureClientEvent } from "@/client/lib/posthog";
import { authClient, useSession } from "@/lib/auth-client";
import { hasOrgPermission } from "@/lib/org-permissions";
import {
  createMemberPasswordLink,
  getTeam,
  sendTeamInvitation,
} from "@/serverFunctions/organization";
import { PasswordLinkModal } from "@/client/features/team/PasswordLinkModal";

// The Organization tab of account settings: who has access to the active org.
export function TeamSettings() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  // Shown once, then dropped from memory. The link is a credential.
  const [passwordLink, setPasswordLink] = useState<{
    url: string;
    email: string;
    expiresAt: string;
  } | null>(null);

  const orgContextQuery = useQuery(organizationContextQueryOptions());

  const teamQuery = useQuery({
    queryKey: ["organization-team", orgContextQuery.data?.organizationId],
    queryFn: () => getTeam(),
    enabled: orgContextQuery.data?.organizationId !== undefined,
  });

  const refreshTeam = () =>
    queryClient.invalidateQueries({
      queryKey: ["organization-team", orgContextQuery.data?.organizationId],
    });

  // Same server call as inviting: for an already-pending address it re-mails
  // the same link with a refreshed expiry.
  const resendMutation = useMutation({
    mutationFn: (email: string) => sendTeamInvitation({ data: { email } }),
    onSuccess: () => {
      captureClientEvent("team:invitation_resend");
      toast.success("Invitation resent");
      void refreshTeam();
    },
    onError: (error: Error) => {
      toast.error(inviteErrorMessage(error));
    },
  });

  // Issues a one-hour, single-use link that lets a member choose a password.
  // Email delivery is impossible on this instance (no provider configured), so
  // the link is handed over in the UI instead of sent.
  const passwordLinkMutation = useMutation({
    mutationFn: (email: string) => createMemberPasswordLink({ data: { email } }),
    onSuccess: (link) => {
      captureClientEvent("team:password_link_create");
      setPasswordLink(link);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not create a password link");
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: memberId,
      });
      if (result.error) {
        throw new Error(result.error.message || "Failed to remove the member");
      }
    },
    onSuccess: () => {
      captureClientEvent("team:member_remove");
      toast.success("Member removed");
      void refreshTeam();
    },
    onError: (error: Error) => {
      toast.error(error.message || "We couldn't remove that member.");
    },
  });

  const cancelInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const result = await authClient.organization.cancelInvitation({
        invitationId,
      });
      if (result.error) {
        throw new Error(
          result.error.message || "Failed to cancel the invitation",
        );
      }
    },
    onSuccess: () => {
      captureClientEvent("team:invitation_cancel");
      toast.success("Invitation canceled");
      void refreshTeam();
    },
    onError: (error: Error) => {
      toast.error(error.message || "We couldn't cancel that invitation.");
    },
  });

  const role = orgContextQuery.data?.role ?? "member";
  const canManageTeam = hasOrgPermission(role, { invitation: ["create"] });
  // billing:manage is the owner-only statement (organization:delete is
  // disabled app-wide, so it would read as a dead capability).
  const isOwner = hasOrgPermission(role, { billing: ["manage"] });

  const members = teamQuery.data?.members ?? [];
  const pendingInvitations = teamQuery.data?.pendingInvitations ?? [];

  if (teamQuery.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-base-content/70">
          We couldn&rsquo;t load your team right now.
        </p>
        <button
          type="button"
          className="btn btn-soft btn-sm"
          onClick={() => void teamQuery.refetch()}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium text-base-content/50">Members</h2>
        {canManageTeam ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setIsInviteOpen(true)}
          >
            Invite teammate
          </button>
        ) : null}
      </div>
      <p className="text-sm text-base-content/60">
        Teammates join as Admins. Admins have full access to each project except
        for billing.
      </p>

      {teamQuery.isPending ? (
        <div className="flex justify-center py-6">
          <span className="loading loading-spinner loading-md" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  isSelf={member.userId === session?.user?.id}
                  canManageTeam={canManageTeam}
                  isOwner={isOwner}
                  isRemoving={removeMemberMutation.isPending}
                  isCreatingPasswordLink={passwordLinkMutation.isPending}
                  onRemove={() => removeMemberMutation.mutate(member.id)}
                  onCreatePasswordLink={() =>
                    passwordLinkMutation.mutate(member.user.email)
                  }
                />
              ))}
              {pendingInvitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  canManageTeam={canManageTeam}
                  isResending={resendMutation.isPending}
                  isCanceling={cancelInvitationMutation.isPending}
                  onResend={() => resendMutation.mutate(invitation.email)}
                  onCancel={() =>
                    cancelInvitationMutation.mutate(invitation.id)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isInviteOpen ? (
        <InviteTeammateModal
          onClose={() => setIsInviteOpen(false)}
          onInvited={() => void refreshTeam()}
        />
      ) : null}

      {passwordLink ? (
        <PasswordLinkModal
          link={passwordLink}
          onClose={() => setPasswordLink(null)}
        />
      ) : null}
    </section>
  );
}
