import { Link } from "@tanstack/react-router";
import type { LinkOptions } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ComponentType } from "react";
import {
  ArrowLeftRight,
  Check,
  CreditCard,
  LogOut,
  Settings,
  User,
  X,
} from "lucide-react";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import { switchOrganization } from "@/serverFunctions/organization";
import {
  connectNavGroup,
  getProjectNavGroups,
} from "@/client/navigation/items";
import { ProjectSwitcher } from "@/client/features/projects/ProjectSwitcher";
import { ThemePreferenceMenuItems } from "@/client/components/ThemePreferenceMenuItems";
import { closeDropdown } from "@/client/lib/dropdown";
import { signOutAndRedirect, useSession } from "@/lib/auth-client";
import { isHostedClientAuthMode } from "@/lib/auth-mode";
import { BILLING_ROUTE } from "@/shared/billing";

interface SidebarProps {
  projectId: string | null;
  onNavigate?: () => void;
  onClose?: () => void;
}

const navItemBaseClass =
  "relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm text-base-content/70";

// Hover uses a lighter tint than the active background (bg-base-300/50) so a
// hovered item next to the active one stays visually distinct instead of
// merging into a single block.
const navItemClass = `${navItemBaseClass} transition-colors hover:bg-base-300/30 hover:text-base-content`;

const navItemActiveProps = {
  // Keep the active tint on hover so the active item does not fall back to the
  // lighter hover background of navItemClass.
  className:
    "bg-base-300/50 hover:bg-base-300/50 font-medium text-base-content",
};

function SidebarNavLink({
  icon: Icon,
  label,
  onNavigate,
  linkProps,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onNavigate?: () => void;
  linkProps: LinkOptions;
}) {
  return (
    <Link
      onClick={onNavigate}
      activeOptions={{ exact: false, includeSearch: false }}
      {...linkProps}
      className={navItemClass}
      activeProps={navItemActiveProps}
    >
      {({ isActive }: { isActive: boolean }) => (
        <>
          {isActive ? (
            <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-primary" />
          ) : null}
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
        </>
      )}
    </Link>
  );
}

export function Sidebar({ projectId, onNavigate, onClose }: SidebarProps) {
  const navGroups = [
    ...(projectId ? getProjectNavGroups(projectId) : []),
    connectNavGroup,
  ];
  // Upstream puts a Browse/Chat tab strip here, where Chat opens SAM. SAM
  // needs an OpenRouter subscription we deliberately don't buy: Siba covers
  // conversation, and the MCP server gives Claude direct access to these same
  // tools. The tab is dropped rather than the feature — the /sam route and its
  // components stay untouched so upstream merges keep applying cleanly.

  return (
    <div className="flex h-full w-60 flex-col bg-base-200">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <Link
          to="/"
          onClick={onNavigate}
          className="text-base font-semibold text-base-content"
        >
          Deep Insights
        </Link>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <div className="px-3 pb-1">
        <ProjectSwitcher
          activeProjectId={projectId}
          onCloseDrawer={onNavigate}
        />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-1">
            <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-base-content/40">
              {group.label}
            </div>
            {group.items.map((item) => {
              const { icon, label, ...linkProps } = item;
              return (
                <SidebarNavLink
                  key={linkProps.to}
                  icon={icon}
                  label={label}
                  onNavigate={onNavigate}
                  linkProps={linkProps}
                />
              );
            })}
          </div>
        ))}
      </nav>

      <SidebarFooter onNavigate={onNavigate} />
    </div>
  );
}

function SidebarFooter({ onNavigate }: { onNavigate?: () => void }) {
  const { data: session } = useSession();
  const isHostedMode = isHostedClientAuthMode();
  const email = session?.user?.email;
  const [isSwitching, setIsSwitching] = useState(false);

  const orgContextQuery = useQuery({
    ...organizationContextQueryOptions(),
    enabled: isHostedMode && Boolean(email),
  });
  const organizations = orgContextQuery.data?.organizations ?? [];
  const activeOrganizationId = orgContextQuery.data?.organizationId;

  const closeMenu = () => {
    closeDropdown();
    onNavigate?.();
  };

  async function handleSwitchOrganization(organizationId: string) {
    if (isSwitching || organizationId === activeOrganizationId) return;
    setIsSwitching(true);
    try {
      await switchOrganization({ data: { organizationId } });
      // Full reload: every cached query and the project-scoped URL belong to
      // the previous organization.
      window.location.assign("/");
    } catch {
      setIsSwitching(false);
    }
  }

  return (
    <div className="shrink-0 border-t border-base-300 px-2 py-2 pb-safe">
      {email ? (
        <div className="dropdown dropdown-top w-full">
          <button
            type="button"
            tabIndex={0}
            className={`${navItemClass} w-full`}
            aria-label="Open account menu"
          >
            <User className="h-4 w-4 shrink-0" />
            <span className="truncate" data-ph-mask>
              {email}
            </span>
          </button>
          <ul
            tabIndex={0}
            className="dropdown-content z-30 menu mb-1 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
          >
            {organizations.length > 1 ? (
              <>
                <li className="menu-title flex flex-row items-center gap-1.5 max-w-full">
                  <ArrowLeftRight className="h-3 w-3" />
                  Organization
                </li>
                {organizations.map((organization) => (
                  <li key={organization.organizationId}>
                    <button
                      type="button"
                      disabled={isSwitching}
                      onClick={() =>
                        void handleSwitchOrganization(
                          organization.organizationId,
                        )
                      }
                    >
                      <span className="truncate">
                        {organization.organizationName}
                      </span>
                      {organization.organizationId === activeOrganizationId ? (
                        <Check className="h-4 w-4 shrink-0" />
                      ) : null}
                    </button>
                  </li>
                ))}
                <li
                  aria-hidden
                  className="pointer-events-none my-1 h-px bg-base-300 p-0"
                />
              </>
            ) : null}
            <li>
              <Link to="/settings" onClick={closeMenu}>
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </li>
            {isHostedMode ? (
              <li>
                <Link to={BILLING_ROUTE} onClick={closeMenu}>
                  <CreditCard className="h-4 w-4" />
                  Billing
                </Link>
              </li>
            ) : null}
            <ThemePreferenceMenuItems />
            {isHostedMode ? (
              <>
                <li
                  aria-hidden
                  className="pointer-events-none my-1 h-px bg-base-300 p-0"
                />
                <li>
                  <button
                    type="button"
                    className="text-error"
                    onClick={() => signOutAndRedirect()}
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </li>
              </>
            ) : null}
          </ul>
        </div>
      ) : (
        <SidebarNavLink
          icon={Settings}
          label="Settings"
          onNavigate={onNavigate}
          linkProps={{ to: "/settings" }}
        />
      )}
    </div>
  );
}
