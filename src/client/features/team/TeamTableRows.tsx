import { KeyRound, Link2, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PortalMenu } from "@/client/components/PortalMenu";
import { hasOrgPermission } from "@/lib/org-permissions";

/**
 * Copy the invite link instead of mailing it.
 *
 * Upstream only ever mails an invitation, which needs a Loops account this
 * instance deliberately doesn't have — so "Resend invitation" fails the same
 * way every time and a saved, perfectly valid invitation looks broken. The
 * link is the invitation; handing it over directly is the whole flow for a
 * team this size.
 */
async function copyInviteLink(invitationId: string) {
  const url = `${window.location.origin}/accept-invitation/${invitationId}`;
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    toast.error("Clipboard not available");
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Invite link copied — send it to them directly");
  } catch {
    toast.error("Could not copy to clipboard");
  }
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

function formatRole(role: string) {
  return role
    .split(",")
    .map((name) => ROLE_LABELS[name.trim()] ?? name.trim())
    .join(", ");
}

type Member = {
  id: string;
  userId: string;
  role: string;
  user: { name?: string | null; email: string };
};

type Invitation = {
  id: string;
  email: string;
  role?: string | null;
  expiresAt: Date | string;
};

export function MemberRow({
  member,
  isSelf,
  canManageTeam,
  isOwner,
  isRemoving,
  isCreatingPasswordLink,
  onRemove,
  onCreatePasswordLink,
}: {
  member: Member;
  isSelf: boolean;
  canManageTeam: boolean;
  isOwner: boolean;
  isRemoving: boolean;
  isCreatingPasswordLink: boolean;
  onRemove: () => void;
  onCreatePasswordLink: () => void;
}) {
  const memberIsOwner = hasOrgPermission(member.role, {
    billing: ["manage"],
  });
  // Owners are protected server-side (only an owner can touch an owner; the
  // last owner can't be removed) — don't render controls that would just 403.
  const canRemove = canManageTeam && !isSelf && (!memberIsOwner || isOwner);
  // Setting your own password is never an escalation; doing it for someone
  // else needs the same standing that lets you manage the team. This is the
  // only route in without Google, so it must stay reachable for yourself even
  // when you cannot manage anyone else.
  const canSetPassword = isSelf || canManageTeam;
  const hasMenu = canRemove || canSetPassword;

  return (
    <tr className="hover">
      <td className="max-w-[280px]">
        <p className="truncate font-medium" data-ph-mask>
          {member.user.name || member.user.email}
          {isSelf ? (
            <span className="font-normal text-base-content/50"> (you)</span>
          ) : null}
        </p>
        <p className="truncate text-xs text-base-content/50" data-ph-mask>
          {member.user.email}
        </p>
      </td>
      <td>
        <span className="badge badge-ghost badge-sm">
          {formatRole(member.role)}
        </span>
      </td>
      <td className="text-xs text-base-content/70">Active</td>
      <td>
        {hasMenu ? (
          <PortalMenu
            ariaLabel={`Actions for ${member.user.email}`}
            menuClassName="w-56"
          >
            {(close) => (
              <>
                {canSetPassword ? (
                  <li>
                    <button
                      disabled={isCreatingPasswordLink}
                      onClick={() => {
                        close();
                        onCreatePasswordLink();
                      }}
                    >
                      <KeyRound className="size-3.5" />
                      {isSelf ? "Set my password" : "Create password link"}
                    </button>
                  </li>
                ) : null}
                {canRemove ? (
                  <li>
                    <button
                      className="text-error"
                      disabled={isRemoving}
                      onClick={() => {
                        close();
                        if (
                          window.confirm(
                            `Remove ${member.user.email} from this organization? They lose access immediately.`,
                          )
                        ) {
                          onRemove();
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                      Remove member
                    </button>
                  </li>
                ) : null}
              </>
            )}
          </PortalMenu>
        ) : null}
      </td>
    </tr>
  );
}

export function InvitationRow({
  invitation,
  canManageTeam,
  isResending,
  isCanceling,
  onResend,
  onCancel,
}: {
  invitation: Invitation;
  canManageTeam: boolean;
  isResending: boolean;
  isCanceling: boolean;
  onResend: () => void;
  onCancel: () => void;
}) {
  return (
    <tr className="hover">
      <td className="max-w-[280px]">
        <p className="truncate font-medium" data-ph-mask>
          {invitation.email}
        </p>
      </td>
      <td>
        <span className="badge badge-ghost badge-sm">
          {formatRole(invitation.role ?? "member")}
        </span>
      </td>
      <td className="text-xs text-base-content/70">
        Invited &middot; expires{" "}
        {new Date(invitation.expiresAt).toLocaleDateString()}
      </td>
      <td>
        {canManageTeam ? (
          <PortalMenu
            ariaLabel={`Actions for the invitation to ${invitation.email}`}
            menuClassName="w-52"
          >
            {(close) => (
              <>
                <li>
                  <button
                    onClick={() => {
                      close();
                      void copyInviteLink(invitation.id);
                    }}
                  >
                    <Link2 className="size-3.5" />
                    Copy invite link
                  </button>
                </li>
                <li>
                  <button
                    disabled={isResending}
                    onClick={() => {
                      close();
                      onResend();
                    }}
                  >
                    <Send className="size-3.5" />
                    Resend invitation
                  </button>
                </li>
                <li>
                  <button
                    className="text-error"
                    disabled={isCanceling}
                    onClick={() => {
                      close();
                      onCancel();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    Cancel invitation
                  </button>
                </li>
              </>
            )}
          </PortalMenu>
        ) : null}
      </td>
    </tr>
  );
}
