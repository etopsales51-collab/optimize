import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getPublishSettings,
  inspectPublishProduct,
  savePublishSettings,
  testPublishConnections,
} from "@/serverFunctions/optimize";

export const Route = createFileRoute("/_project/p/$projectId/settings/publishing")({
  component: PublishingSettingsPage,
});

type CredentialStatus = "missing" | "ok" | "unreadable";

/**
 * Where an operator connects the site that approved recommendations get
 * written to.
 *
 * Secrets are write-only by design: the server never returns them, so the
 * fields below start empty and an empty field means "leave the stored one
 * alone". That is why each credential shows a status line instead of a masked
 * value — a masked value would imply the browser had received something it
 * must never receive.
 */
function StatusPill({ status }: { status: CredentialStatus }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <Check className="size-3.5" />
        Stored
      </span>
    );
  }
  if (status === "unreadable") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warning">
        <AlertTriangle className="size-3.5" />
        Stored but unreadable — re-enter it
      </span>
    );
  }
  return <span className="text-xs text-base-content/50">Not set</span>;
}

function PublishingSettingsPage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();

  const queryKey = ["publish-settings", projectId];
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: () => getPublishSettings({ data: { projectId } }),
  });

  const [baseUrl, setBaseUrl] = useState("");
  const [wooKey, setWooKey] = useState("");
  const [wooSecret, setWooSecret] = useState("");
  const [wpUsername, setWpUsername] = useState("");
  const [wpAppPassword, setWpAppPassword] = useState("");
  const [enabled, setEnabled] = useState(false);

  // Seed the non-secret fields from the server once loaded. Secrets stay blank
  // because the server does not return them.
  useEffect(() => {
    if (!data) return;
    setBaseUrl(data.wordpressBaseUrl ?? "");
    setWooKey(data.wooConsumerKey ?? "");
    setWpUsername(data.wpUsername ?? "");
    setEnabled(data.publishingEnabled);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      savePublishSettings({
        data: {
          projectId,
          wordpressBaseUrl: baseUrl.trim(),
          wooConsumerKey: wooKey.trim(),
          // Blank means "keep what is stored".
          wooConsumerSecret: wooSecret,
          wpUsername: wpUsername.trim(),
          wpAppPassword,
          publishingEnabled: enabled,
        },
      }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(queryKey, fresh);
      setWooSecret("");
      setWpAppPassword("");
      toast.success("Publishing settings saved");
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not save these settings.")),
  });

  // Verifies what is stored, without the secret ever leaving the server.
  const testMutation = useMutation({
    mutationFn: () => testPublishConnections({ data: { projectId } }),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not test the connection.")),
  });

  // Read-only: shows what one product stores, so the field a template reads
  // for its datasheet can be found without anyone handling the credential.
  const [inspectUrl, setInspectUrl] = useState("");
  const inspectMutation = useMutation({
    mutationFn: () =>
      inspectPublishProduct({ data: { projectId, productUrl: inspectUrl.trim() } }),
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not inspect that product.")),
  });

  if (isPending || !data) {
    return <div className="h-40 animate-pulse rounded-lg bg-base-200" />;
  }

  const wooReady =
    data.wooCredentialStatus === "ok" && Boolean(data.wordpressBaseUrl);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Publishing</h2>
        <p className="mt-1 text-sm text-base-content/70">
          Where approved recommendations are written. Nothing is published
          without a person approving it first, and nothing at all is published
          while the switch below is off.
        </p>
        <p className="mt-2 text-xs text-base-content/55">
          These credentials belong to this project alone. Each project stores
          its own and never reads another&rsquo;s — the status beside each
          field below is what is saved for <strong>this</strong> project. If a
          field looks pre-filled but the status says &ldquo;Not set&rdquo;,
          that is your browser autofilling, not a saved value; clear it before
          saving.
        </p>
      </div>

      <section className="space-y-3 rounded-lg border border-base-300 p-4">
        <div>
          <h3 className="text-sm font-semibold">Site</h3>
          <label className="mt-2 block">
            <span className="text-xs text-base-content/60">
              Site URL — no trailing slash
            </span>
            <input
              type="url"
              name="di-site-url"
              autoComplete="off"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://wacomme.ae"
              className="input input-bordered mt-1 w-full"
            />
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-base-300 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">WooCommerce — products</h3>
          <StatusPill status={data.wooCredentialStatus} />
        </div>
        <p className="text-xs text-base-content/60">
          Required for product SEO. Rank Math&rsquo;s fields are not exposed on
          the WordPress API, so product titles and descriptions can only be
          written through WooCommerce. Create the key under WooCommerce →
          Settings → Advanced → REST API with Read/Write permission.
        </p>
        <label className="block">
          <span className="text-xs text-base-content/60">Consumer key</span>
          <input
            name="di-woo-key"
            autoComplete="off"
            value={wooKey}
            onChange={(event) => setWooKey(event.target.value)}
            placeholder="ck_…"
            className="input input-bordered mt-1 w-full font-mono text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-base-content/60">
            Consumer secret — leave blank to keep the stored one
          </span>
          <input
            type="password"
            name="di-woo-secret"
            autoComplete="new-password"
            value={wooSecret}
            onChange={(event) => setWooSecret(event.target.value)}
            placeholder="cs_…"
            className="input input-bordered mt-1 w-full font-mono text-sm"
          />
        </label>
      </section>

      <section className="space-y-3 rounded-lg border border-base-300 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            WordPress — pages and posts
          </h3>
          <StatusPill status={data.wpCredentialStatus} />
        </div>
        <p className="text-xs text-base-content/60">
          Optional today; needed once recommendations target pages or blog
          posts. Use an application password on a dedicated user with the{" "}
          <strong>Editor</strong> role — that role cannot reach orders,
          customers or settings, which is the scoping a WooCommerce key cannot
          give you.
        </p>
        <label className="block">
          <span className="text-xs text-base-content/60">Username</span>
          <input
            name="di-wp-username"
            autoComplete="off"
            value={wpUsername}
            onChange={(event) => setWpUsername(event.target.value)}
            placeholder="deepinsights-bot"
            className="input input-bordered mt-1 w-full"
          />
        </label>
        <label className="block">
          <span className="text-xs text-base-content/60">
            Application password — leave blank to keep the stored one
          </span>
          <input
            type="password"
            name="di-wp-app-password"
            autoComplete="new-password"
            value={wpAppPassword}
            onChange={(event) => setWpAppPassword(event.target.value)}
            placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
            className="input input-bordered mt-1 w-full font-mono text-sm"
          />
        </label>
      </section>

      <section className="space-y-3 rounded-lg border border-base-300 p-4">
        <h3 className="text-sm font-semibold">Allow publishing</h3>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="checkbox checkbox-sm mt-0.5"
            disabled={!wooReady && !enabled}
          />
          <span className="text-sm">
            Let approved recommendations write to the live site
            <span className="mt-0.5 block text-xs text-base-content/60">
              {wooReady
                ? "Approving still does not publish on its own — publishing is a separate, deliberate action on each item."
                : "Add the site URL and a working WooCommerce key before switching this on."}
            </span>
          </span>
        </label>

        {enabled ? (
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              A WooCommerce key with Read/Write can change prices and read
              orders. This app writes only the SEO title and meta description
              and never touches the product name, price, stock or status — but
              the key itself is not limited that way, so keep it private and
              revoke it if it leaks.
            </p>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? "Saving…" : "Save publishing settings"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={testMutation.isPending}
          onClick={() => testMutation.mutate()}
        >
          {testMutation.isPending ? "Testing…" : "Test connection"}
        </button>
      </div>

      {testMutation.data ? (
        <ul className="space-y-2">
          {testMutation.data.checks.map((check) => (
            <li
              key={check.channel}
              className={`flex gap-2 rounded-lg border p-3 text-sm ${
                check.ok
                  ? "border-success/40 bg-success/5"
                  : "border-base-300 bg-base-200/50"
              }`}
            >
              {check.ok ? (
                <Check className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0 text-base-content/40" />
              )}
              <span>
                <span className="font-medium">
                  {check.channel === "woocommerce"
                    ? "WooCommerce — products"
                    : "WordPress — pages and posts"}
                </span>
                <span className="block text-base-content/70">
                  {check.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="space-y-3 rounded-lg border border-base-300 p-4">
        <h3 className="text-sm font-semibold">Inspect a product</h3>
        <p className="text-xs text-base-content/60">
          Read-only. Shows the fields WooCommerce stores for one product, so we
          can see which one this site&rsquo;s template reads for its datasheet
          before publishing learns to write it. Nothing is changed.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="url"
            name="di-inspect-url"
            autoComplete="off"
            value={inspectUrl}
            onChange={(event) => setInspectUrl(event.target.value)}
            placeholder="https://wacomme.ae/product/wacom-pl-1600-pen-display/"
            className="input input-bordered input-sm min-w-0 flex-1"
          />
          <button
            type="button"
            className="btn btn-sm"
            disabled={!inspectUrl.trim() || inspectMutation.isPending}
            onClick={() => inspectMutation.mutate()}
          >
            {inspectMutation.isPending ? "Reading…" : "Show fields"}
          </button>
        </div>

        {inspectMutation.data ? (
          inspectMutation.data.ok ? (
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium">{inspectMutation.data.name}</span>
                <span className="text-base-content/60">
                  {" "}
                  · id {inspectMutation.data.productId} ·{" "}
                  {inspectMutation.data.status} ·{" "}
                  {inspectMutation.data.categories.join(", ") || "no category"}
                </span>
              </p>
              <div className="overflow-x-auto">
                <table className="table table-xs">
                  <thead>
                    <tr>
                      <th>Meta key</th>
                      <th>Value (truncated)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspectMutation.data.metaKeys.map((row) => (
                      <tr key={row.key}>
                        <td className="font-mono text-xs">{row.key}</td>
                        <td className="max-w-md truncate font-mono text-xs text-base-content/70">
                          {row.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-warning">{inspectMutation.data.reason}</p>
          )
        ) : null}
      </section>
    </div>
  );
}
