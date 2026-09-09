import { Bot, Send, User } from "lucide-react";
import { useState } from "react";

/**
 * The single conversation surface.
 *
 * Staff and the agent post into the same thread, so "I asked for X" and the
 * agent's answer sit next to each other rather than in two systems. Agent
 * messages are visually distinct but not diminished — the agent is doing the
 * work, and staff need to read it as a colleague's reply.
 */

export type ThreadComment = {
  id: string;
  authorType: "user" | "agent";
  authorLabel: string;
  body: string;
  createdAt: string;
};

function formatWhen(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function CommentThread({
  comments,
  isPosting,
  onPost,
}: {
  comments: ThreadComment[];
  isPosting: boolean;
  onPost: (body: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    onPost(body);
    setDraft("");
  };

  return (
    <section className="rounded-lg border border-base-300 bg-base-100 p-4">
      <h3 className="text-sm font-semibold">
        Discussion{comments.length ? ` (${comments.length})` : ""}
      </h3>

      {comments.length ? (
        <ul className="mt-3 space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-2.5">
              <span
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
                  comment.authorType === "agent"
                    ? "bg-primary/10 text-primary"
                    : "bg-base-300 text-base-content/70"
                }`}
              >
                {comment.authorType === "agent" ? (
                  <Bot className="size-3.5" />
                ) : (
                  <User className="size-3.5" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-base-content/55">
                  <span className="font-medium text-base-content/80">
                    {comment.authorLabel}
                  </span>{" "}
                  &middot; {formatWhen(comment.createdAt)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">
                  {comment.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-base-content/55">
          No messages yet. Anything you write here reaches the agent.
        </p>
      )}

      <div className="mt-4">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. Matches every chat the
            // team already uses.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="Ask a question, or say what you want changed…"
          className="textarea textarea-bordered w-full text-sm"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-base-content/45">
            Enter to send, Shift+Enter for a new line
          </p>
          <button
            type="button"
            className="btn btn-sm gap-1.5"
            disabled={isPosting || !draft.trim()}
            onClick={submit}
          >
            <Send className="size-3.5" />
            Comment
          </button>
        </div>
      </div>
    </section>
  );
}
