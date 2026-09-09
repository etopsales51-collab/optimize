import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { getAuthMode, isHostedClientAuthMode } from "@/lib/auth-mode";
import { captureClientEvent } from "@/client/lib/posthog";
import { ClaudeIcon, CodexIcon } from "@/client/features/ai-mcp/AgentIcons";
import { AvailableTools } from "@/client/features/ai-mcp/AvailableTools";
import {
  CodeBlock,
  Collapsible,
  CopyButton,
} from "@/client/features/ai-mcp/SetupControls";

const SUPPORT_EMAIL = "walid@etopme.ae";

export const Route = createFileRoute("/_app/ai")({
  component: AiPage,
});

function AiPage() {
  const mcpUrl =
    typeof window === "undefined"
      ? "https://seo.deepinsights.space/mcp"
      : `${window.location.origin}/mcp`;

  return (
    <div className="h-full overflow-auto bg-base-100 px-4 py-12 md:px-6 md:py-16 pb-24 md:pb-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">AI & MCP</h1>
        <p className="mt-2 text-sm text-base-content/70 leading-relaxed">
          Connect your AI agent to Deep Insights. Run keyword research, SERP analysis,
          domain lookups, and backlink reviews from your editor or chat.
        </p>

        {getAuthMode(import.meta.env.AUTH_MODE) === "cloudflare_access" ? (
          <div className="alert alert-warning mt-6 text-sm" role="alert">
            <ShieldAlert className="size-4 shrink-0" />
            <span>
              This instance is behind Cloudflare Access. MCP clients cannot
              connect until Managed OAuth is enabled on your Access application.
            </span>
          </div>
        ) : null}

        <section className="mt-8">
          <div className="rounded-lg border border-base-300 bg-base-200 px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-base-content/50">
                MCP server URL
              </p>
              <CopyButton
                value={mcpUrl}
                successMessage="MCP URL copied"
                onCopy={() => captureClientEvent("mcp:setup_url_copy")}
              />
            </div>
            <code className="mt-2 block break-all font-mono text-sm text-base-content">
              {mcpUrl}
            </code>
          </div>
          <p className="mt-2.5 text-xs text-base-content/55 leading-relaxed">
            Paste this into any MCP client. This URL points at the Deep Insights
            instance you are using now, whether hosted, self-hosted, or local.
            Sign in with Deep Insights when prompted.
          </p>
          {isHostedClientAuthMode() ? (
            <p className="mt-2 text-xs text-base-content/55">
              For headless or CI setups, use an API key from{" "}
              <Link className="link link-primary" to="/settings">
                Settings
              </Link>{" "}
              instead of the OAuth login.
            </p>
          ) : null}
        </section>

        <section className="mt-10">
          <h2 className="text-base font-semibold">Setup guides</h2>
          <p className="mt-1.5 text-sm text-base-content/70">
            Pick your agent.
          </p>
          <div className="mt-4 divide-y divide-base-300 overflow-hidden rounded-lg border border-base-300 bg-base-200">
            <Collapsible
              id="claude-code"
              title="Claude Code"
              subtitle="Add with the CLI"
              icon={<ClaudeIcon className="size-5" />}
            >
              <p className="text-sm text-base-content/70">
                Run this in your terminal:
              </p>
              <CodeBlock
                code={`claude mcp add --transport http --scope user deep-insights ${mcpUrl}`}
                onCopy={() =>
                  captureClientEvent("mcp:setup_command_copy", {
                    agent: "claude-code",
                  })
                }
              />
              <p className="text-sm text-base-content/70">
                Approve the login when prompted.
              </p>
            </Collapsible>

            <Collapsible
              id="claude-desktop"
              title="Claude Desktop"
              subtitle="Add a custom connector"
              icon={<ClaudeIcon className="size-5" />}
            >
              <ol className="ml-5 list-decimal space-y-1.5 text-sm text-base-content/70 leading-relaxed">
                <li>
                  Open <span className="text-base-content">Settings</span> →{" "}
                  <span className="text-base-content">Connectors</span>.
                </li>
                <li>
                  Click{" "}
                  <span className="font-medium text-base-content">
                    Add custom connector
                  </span>
                  .
                </li>
                <li>Paste the MCP URL above and click Add.</li>
                <li>Approve the Deep Insights login when prompted.</li>
                <li>
                  Optional: after Deep Insights connects, click{" "}
                  <span className="font-medium text-base-content">
                    Configure
                  </span>
                  , then choose{" "}
                  <span className="font-medium text-base-content">
                    Always Approved
                  </span>
                  , except for any tools you want Claude to ask before using.
                </li>
              </ol>
              <p className="text-xs text-base-content/55 leading-relaxed">
                Requires a Claude Pro, Max, Team, or Enterprise plan.
              </p>
            </Collapsible>

            <Collapsible
              id="codex"
              title="Codex"
              subtitle="Add with the CLI"
              icon={<CodexIcon className="size-5" />}
            >
              <p className="text-sm text-base-content/70">
                Run this in your terminal:
              </p>
              <CodeBlock
                code={`codex mcp add deep-insights --url ${mcpUrl}`}
                onCopy={() =>
                  captureClientEvent("mcp:setup_command_copy", {
                    agent: "codex",
                  })
                }
              />
              <p className="text-sm text-base-content/70">
                Approve the login when prompted.
              </p>
            </Collapsible>

            <Collapsible
              id="codex-desktop"
              title="Codex Desktop"
              subtitle="Settings → Integrations & MCP"
              icon={<CodexIcon className="size-5" />}
            >
              <ol className="ml-5 list-decimal space-y-1.5 text-sm text-base-content/70 leading-relaxed">
                <li>
                  Open{" "}
                  <span className="text-base-content">
                    Settings → Integrations & MCP
                  </span>
                  .
                </li>
                <li>
                  Click{" "}
                  <span className="font-medium text-base-content">
                    Add your own
                  </span>
                  .
                </li>
                <li>Paste the MCP URL above.</li>
                <li>Approve the Deep Insights login when prompted.</li>
              </ol>
            </Collapsible>
          </div>
        </section>

                <section className="mt-12">
          <h2 className="text-base font-semibold">Available tools</h2>
          <div className="mt-5">
            <AvailableTools />
          </div>
        </section>

        <p className="mt-12 text-xs text-base-content/55 leading-relaxed">
          Questions about this instance? Email{" "}
          <a className="link link-primary" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
