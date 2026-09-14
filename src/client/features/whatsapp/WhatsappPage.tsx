import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  MessageCircle,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addWhatsappRecipient,
  getWhatsappOverview,
  getWhatsappThread,
  removeWhatsappRecipient,
  sendWhatsappMessage,
  updateWhatsappRecipient,
} from "@/serverFunctions/whatsapp";

/**
 * The team's WhatsApp channel: one conversation per person, fed by alerts from
 * every project and by the team's replies. Grok reads the same thread over MCP.
 *
 * Polls rather than streams, because replies are human-paced and the channel is
 * deliberately quiet; a minute-old message is fine, a held connection is not
 * worth it.
 */

type Scope = "project" | "all";
type Overview = Awaited<ReturnType<typeof getWhatsappOverview>>;
type Conversation = Overview["conversations"][number];
type ThreadMessage = Awaited<ReturnType<typeof getWhatsappThread>>[number];

const ALERT_LABELS: Record<string, string> = {
  keyword_drop: "Keyword drop",
  audit_warning: "Audit",
  approval_needed: "Needs approval",
  published: "Published",
  publish_failed: "Publish failed",
  progress: "Progress",
};

const AUTHOR_LABELS: Record<string, string> = {
  system: "Deep Insights",
  user: "You",
  agent: "Grok",
  recipient: "",
};

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : new Date(iso).toLocaleDateString();
}

export function WhatsappPage({ projectId }: { projectId: string }) {
  const [scope, setScope] = useState<Scope>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);

  const overviewKey = ["whatsapp-overview", projectId, scope];
  const overview = useQuery({
    queryKey: overviewKey,
    queryFn: () => getWhatsappOverview({ data: { projectId, scope } }),
    refetchInterval: 20_000,
  });

  const conversations = overview.data?.conversations ?? [];

  // Open the most recent conversation by default, and recover if the selected
  // person is removed.
  useEffect(() => {
    if (conversations.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !conversations.some((c) => c.recipient.id === selectedId)) {
      setSelectedId(conversations[0].recipient.id);
    }
  }, [conversations, selectedId]);

  if (overview.isError) {
    return (
      <PageShell>
        <div className="alert alert-error text-sm">
          {getStandardErrorMessage(
            overview.error,
            "Could not load WhatsApp. Only organization owners and admins can open it.",
          )}
        </div>
      </PageShell>
    );
  }

  const selected = conversations.find((c) => c.recipient.id === selectedId) ?? null;

  return (
    <PageShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">WhatsApp</h1>
          <p className="mt-1 text-sm text-base-content/70">
            Alerts from every project and your team&rsquo;s replies. Grok reads
            this channel and asks for approval here.
          </p>
        </div>
        <div className="join">
          {(["all", "project"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`btn join-item btn-sm ${scope === value ? "btn-active" : ""}`}
              onClick={() => setScope(value)}
            >
              {value === "all" ? "All projects" : "This project"}
            </button>
          ))}
        </div>
      </div>

      {overview.data ? <ConnectionBanner status={overview.data.status} /> : null}

      <div className="grid min-h-[32rem] gap-4 md:grid-cols-[18rem_1fr]">
        <aside className="flex flex-col rounded-lg border border-base-300">
          <div className="flex items-center justify-between border-b border-base-300 px-3 py-2">
            <span className="text-sm font-medium">Team</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs gap-1"
              onClick={() => setManaging((open) => !open)}
            >
              <Users className="size-3.5" />
              {managing ? "Done" : "Manage"}
            </button>
          </div>

          {managing ? (
            <RecipientManager
              projectId={projectId}
              conversations={conversations}
              onChanged={() => void overview.refetch()}
            />
          ) : overview.isPending ? (
            <div className="p-4 text-sm text-base-content/50">Loading…</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-sm text-base-content/60">
              No one to message yet. Choose Manage and add yourself and your
              manager.
            </div>
          ) : (
            <ul className="flex-1 divide-y divide-base-300 overflow-auto">
              {conversations.map((conversation) => (
                <ConversationRow
                  key={conversation.recipient.id}
                  conversation={conversation}
                  active={conversation.recipient.id === selectedId}
                  onSelect={() => setSelectedId(conversation.recipient.id)}
                />
              ))}
            </ul>
          )}
        </aside>

        <section className="flex min-h-0 flex-col rounded-lg border border-base-300">
          {selected ? (
            <Thread
              key={`${selected.recipient.id}:${scope}`}
              projectId={projectId}
              scope={scope}
              conversation={selected}
              onSent={() => void overview.refetch()}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-base-content/50">
              <MessageCircle className="size-6" />
              Pick a person to see the conversation.
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-6xl space-y-4">{children}</div>
    </div>
  );
}

function ConnectionBanner({ status }: { status: Overview["status"] }) {
  if (status.connected && status.inboundTokenConfigured) {
    return status.templateConfigured ? null : (
      <p className="text-xs text-base-content/55">
        Alerts reach people who have messaged the number in the last 24 hours.
        To reach them anytime, add an approved template as
        TWILIO_ALERT_TEMPLATE_SID.
      </p>
    );
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-medium">
          {status.connected
            ? "Replies won't arrive yet"
            : "WhatsApp isn't connected yet"}
        </p>
        <p className="text-base-content/70">
          {status.connected
            ? "Add WHATSAPP_INBOUND_TOKEN on Railway."
            : `Add ${status.missing.join(", ")} and WHATSAPP_INBOUND_TOKEN on Railway. Alerts are kept here until then.`}
        </p>
        <p className="text-base-content/70">
          Twilio &ldquo;When a message comes in&rdquo; webhook:{" "}
          <code className="break-all text-xs">
            {origin}
            {status.webhookPath}
          </code>
        </p>
      </div>
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  onSelect,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
}) {
  const { recipient, latest } = conversation;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`block w-full px-3 py-2.5 text-left hover:bg-base-200/60 ${active ? "bg-base-200" : ""}`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">
            {recipient.name}
            {recipient.enabled ? null : (
              <span className="ml-1.5 text-xs font-normal text-base-content/40">
                paused
              </span>
            )}
          </span>
          <span className="shrink-0 text-xs text-base-content/40">
            {timeAgo(latest?.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-base-content/60">
          {latest
            ? `${latest.direction === "out" ? "→ " : ""}${latest.body.replace(/\s+/g, " ")}`
            : recipient.phone}
        </p>
      </button>
    </li>
  );
}

function Thread({
  projectId,
  scope,
  conversation,
  onSent,
}: {
  projectId: string;
  scope: Scope;
  conversation: Conversation;
  onSent: () => void;
}) {
  const recipientId = conversation.recipient.id;
  const [draft, setDraft] = useState("");
  const [tagProject, setTagProject] = useState(scope === "project");

  const thread = useQuery({
    queryKey: ["whatsapp-thread", projectId, recipientId, scope],
    queryFn: () =>
      getWhatsappThread({ data: { projectId, recipientId, scope } }),
    refetchInterval: 15_000,
  });

  const send = useMutation({
    mutationFn: () =>
      sendWhatsappMessage({
        data: { projectId, recipientId, body: draft, tagProject },
      }),
    onSuccess: () => {
      setDraft("");
      void thread.refetch();
      onSent();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not send the message.")),
  });

  return (
    <>
      <header className="flex items-center justify-between border-b border-base-300 px-4 py-2">
        <div>
          <p className="text-sm font-medium">{conversation.recipient.name}</p>
          <p className="text-xs text-base-content/50">
            {conversation.recipient.phone}
          </p>
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-auto bg-base-200/30 p-4">
        {thread.isPending ? (
          <p className="text-sm text-base-content/50">Loading…</p>
        ) : (thread.data ?? []).length === 0 ? (
          <p className="text-center text-sm text-base-content/50">
            No messages yet.
          </p>
        ) : (
          (thread.data ?? []).map((message) => (
            <Bubble key={message.id} message={message} />
          ))
        )}
      </div>

      <form
        className="space-y-2 border-t border-base-300 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim() && !send.isPending) send.mutate();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (draft.trim() && !send.isPending) send.mutate();
            }
          }}
          rows={2}
          maxLength={1500}
          placeholder={`Message ${conversation.recipient.name}…`}
          className="textarea textarea-bordered w-full text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-base-content/60">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={tagProject}
              onChange={(event) => setTagProject(event.target.checked)}
            />
            About this project
          </label>
          <button
            type="submit"
            className="btn btn-sm gap-1.5 border-0 bg-[#25D366] text-black hover:bg-[#1ebe5a]"
            disabled={!draft.trim() || send.isPending}
          >
            <Send className="size-3.5" />
            {send.isPending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </>
  );
}

function Bubble({ message }: { message: ThreadMessage }) {
  const outbound = message.direction === "out";
  const author = AUTHOR_LABELS[message.author] ?? "";

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          outbound
            ? "rounded-br-sm bg-[#25D366] text-black"
            : "rounded-bl-sm bg-base-100 text-base-content"
        }`}
      >
        {message.kind === "alert" || message.projectId ? (
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
            {message.alertType ? (
              <span className="rounded bg-black/10 px-1.5 py-0.5">
                {ALERT_LABELS[message.alertType] ?? message.alertType}
              </span>
            ) : null}
            {message.projectId && message.projectName ? (
              <Link
                to="/p/$projectId"
                params={{ projectId: message.projectId }}
                className="underline-offset-2 hover:underline"
              >
                {message.projectName}
              </Link>
            ) : null}
          </div>
        ) : null}

        <p className="whitespace-pre-wrap break-words">{message.body}</p>

        <p
          className={`mt-1 text-right text-[11px] ${outbound ? "text-black/60" : "text-base-content/45"}`}
        >
          {author ? `${author} · ` : ""}
          {timeAgo(message.createdAt)}
          {outbound && message.status ? ` · ${message.status.replace("_", " ")}` : ""}
        </p>
        {message.error ? (
          <p className="mt-1 text-[11px] text-red-900">{message.error}</p>
        ) : null}
      </div>
    </div>
  );
}

function RecipientManager({
  projectId,
  conversations,
  onChanged,
}: {
  projectId: string;
  conversations: Conversation[];
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["whatsapp-overview", projectId] });
    onChanged();
  };
  const fail = (fallback: string) => (error: unknown) =>
    toast.error(getStandardErrorMessage(error, fallback));

  const add = useMutation({
    mutationFn: () => addWhatsappRecipient({ data: { projectId, name, phone } }),
    onSuccess: () => {
      setName("");
      setPhone("");
      toast.success("Added");
      refresh();
    },
    onError: fail("Could not add that person."),
  });

  const toggle = useMutation({
    mutationFn: (input: { recipientId: string; enabled: boolean }) =>
      updateWhatsappRecipient({ data: { projectId, ...input } }),
    onSuccess: refresh,
    onError: fail("Could not update."),
  });

  const remove = useMutation({
    mutationFn: (recipientId: string) =>
      removeWhatsappRecipient({ data: { projectId, recipientId } }),
    onSuccess: () => {
      setConfirmingId(null);
      refresh();
    },
    onError: fail("Could not remove."),
  });

  return (
    <div className="flex-1 space-y-3 overflow-auto p-3">
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && phone.trim() && !add.isPending) add.mutate();
        }}
      >
        <input
          name="di-wa-name"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          maxLength={80}
          className="input input-bordered input-sm w-full"
        />
        <input
          name="di-wa-phone"
          autoComplete="off"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+971 50 123 4567"
          className="input input-bordered input-sm w-full"
        />
        <button
          type="submit"
          className="btn btn-sm w-full gap-1"
          disabled={!name.trim() || !phone.trim() || add.isPending}
        >
          <Plus className="size-3.5" />
          Add person
        </button>
      </form>

      <ul className="divide-y divide-base-300 rounded-lg border border-base-300">
        {conversations.length === 0 ? (
          <li className="p-3 text-xs text-base-content/50">No one added yet.</li>
        ) : (
          conversations.map(({ recipient }) => (
            <li key={recipient.id} className="space-y-1.5 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{recipient.name}</p>
                  <p className="text-xs text-base-content/50">{recipient.phone}</p>
                </div>
                <input
                  type="checkbox"
                  className="toggle toggle-sm toggle-success"
                  aria-label={`Send alerts to ${recipient.name}`}
                  checked={recipient.enabled}
                  disabled={toggle.isPending}
                  onChange={(event) =>
                    toggle.mutate({
                      recipientId: recipient.id,
                      enabled: event.target.checked,
                    })
                  }
                />
              </div>
              {confirmingId === recipient.id ? (
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="btn btn-error btn-xs"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(recipient.id)}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => setConfirmingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs gap-1 text-error"
                  onClick={() => setConfirmingId(recipient.id)}
                >
                  <Trash2 className="size-3" />
                  Remove
                </button>
              )}
            </li>
          ))
        )}
      </ul>
      <p className="text-[11px] text-base-content/50">
        The toggle pauses alerts to that person without deleting their history.
      </p>
    </div>
  );
}
