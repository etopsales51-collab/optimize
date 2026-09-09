import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Hands over a password set-up link.
 *
 * The link IS a credential: whoever opens it chooses that account's password.
 * So it is shown once, never persisted client-side, and the modal says plainly
 * what it does and how long it lasts. Deliberately no "email it" button —
 * there is no email provider on this instance, which is the whole reason this
 * screen exists.
 */
export function PasswordLinkModal({
  link,
  onClose,
}: {
  link: { url: string; email: string; expiresAt: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("Clipboard not available");
      return;
    }
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  const expires = new Date(link.expiresAt);

  return (
    <div className="modal modal-open" role="dialog">
      <div className="modal-box max-w-lg">
        <h3 className="text-lg font-semibold">Password link for {link.email}</h3>
        <p className="mt-2 text-sm text-base-content/70">
          Open this link to choose a password for that account. It works once,
          and expires at{" "}
          <span className="font-medium text-base-content">
            {expires.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>{" "}
          today.
        </p>

        <div className="mt-4 rounded-lg border border-base-300 bg-base-200 p-3">
          <p className="break-all font-mono text-xs" data-ph-mask>
            {link.url}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleCopy()}
          className="btn btn-sm mt-3 gap-2"
        >
          {copied ? (
            <Check className="size-3.5 text-success" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy link"}
        </button>

        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
          <p className="font-medium">Treat this like a password</p>
          <p className="mt-1 text-base-content/70">
            Anyone with the link can set this account&rsquo;s password. Send it
            over a channel you trust, and note that using it signs that account
            out of every device.
          </p>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
    </div>
  );
}
