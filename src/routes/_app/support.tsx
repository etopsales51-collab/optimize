import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const SUPPORT_EMAIL = "walid@etopme.ae";

export const Route = createFileRoute("/_app/support")({
  component: SupportPage,
});

function SupportPage() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(SUPPORT_EMAIL);
    toast.success("Email copied to clipboard");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full overflow-auto bg-base-100 px-4 py-8 pb-24 md:px-6 md:py-12 md:pb-8">
      <div className="mx-auto max-w-xl">
        <p className="text-sm font-medium text-base-content/40">
          Support
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          We want to hear from you
        </h1>
        <p className="mt-2 text-sm text-base-content/60">
          Found a problem or want something added to Deep Insights? Get in
          touch and it goes straight to the person who maintains it.
        </p>

        <div className="mt-8 space-y-3">
          <div className="rounded-lg border border-base-300 px-5 py-4">
            <p className="text-sm font-semibold">Email</p>
            <p className="mt-1 text-sm text-base-content/60">
              Send ideas, problems, questions, or feedback directly.
            </p>
            <button
              type="button"
              onClick={handleCopy}
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-base-300 bg-base-200/50 px-3 py-1.5 text-sm font-medium text-base-content transition-colors hover:bg-base-200"
            >
              <span className="font-mono text-xs">{SUPPORT_EMAIL}</span>
              {copied ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <Copy className="size-3.5 text-base-content/40" />
              )}
            </button>
          </div>


        </div>
      </div>
    </div>
  );
}
