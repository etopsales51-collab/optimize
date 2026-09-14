/**
 * The decisions behind the WhatsApp channel, kept free of database, Twilio and
 * Workers imports so each one is tested directly.
 *
 * The channel is deliberately quiet. WhatsApp is a phone that buzzes, and a
 * team that gets a message per keyword learns to mute it. So an event produces
 * at most one message, minor movements produce none, and every message is
 * short enough to read on a lock screen.
 */

/** WhatsApp caps a message at 1600 characters; stay clear of it. */
export const MAX_BODY_CHARS = 1500;

/** WhatsApp allows free-form business messages this long after the person's last message. */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A phone number as digits only, country code first: "whatsapp:+971 50-123 4567"
 * becomes "971501234567". A leading international "00" is dropped. Null when
 * what is left cannot be a phone number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/^whatsapp:/i, "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/**
 * Two numbers are the same person when their last nine digits agree. That
 * absorbs the forms people actually type — with or without the country code,
 * with a trunk zero ("0501234567" against "971501234567") — without matching
 * unrelated numbers, which differ within the subscriber digits.
 */
export function phonesMatch(a: string | null, b: string | null): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (!left || !right) return false;
  return left.slice(-9) === right.slice(-9);
}

export type SendMode = "freeform" | "template";

/**
 * How a message must be sent. Inside the 24-hour window any text goes. Outside
 * it WhatsApp rejects free-form text from a business, so a pre-approved
 * template is used when one is configured. Without a template the message is
 * still attempted free-form: Twilio then returns its own explanation, which is
 * recorded on the message rather than hidden.
 */
export function chooseSendMode(
  lastInboundAt: string | null,
  templateSid: string | null | undefined,
  now: Date = new Date(),
): SendMode {
  const last = lastInboundAt ? Date.parse(lastInboundAt) : Number.NaN;
  const inWindow =
    Number.isFinite(last) && now.getTime() - last < SESSION_WINDOW_MS;
  if (inWindow || !templateSid) return "freeform";
  return "template";
}

/** Clip to what WhatsApp accepts, marking the cut. */
export function clipBody(body: string): string {
  const text = body.trim();
  return text.length > MAX_BODY_CHARS
    ? `${text.slice(0, MAX_BODY_CHARS - 1)}…`
    : text;
}

/**
 * The shape every alert takes: project first, so a glance at the notification
 * says which site it is about; a one-line headline; a few detail lines; the
 * link that opens the thing to act on.
 */
export function formatAlert(input: {
  projectName: string;
  headline: string;
  lines?: string[];
  link?: string | null;
  maxLines?: number;
}): string {
  const maxLines = input.maxLines ?? 8;
  const lines = input.lines ?? [];
  const shown = lines.slice(0, maxLines);
  const hidden = lines.length - shown.length;

  const parts = [`*${input.projectName}* · ${input.headline}`];
  if (shown.length > 0) {
    parts.push(shown.map((line) => `• ${line}`).join("\n"));
  }
  if (hidden > 0) parts.push(`+${hidden} more`);
  if (input.link) parts.push(input.link);
  return clipBody(parts.join("\n\n"));
}

// ---------------------------------------------------------------------------
// Keyword drops
// ---------------------------------------------------------------------------

export type PositionSnapshot = {
  trackingKeywordId: string;
  keyword: string;
  device: "desktop" | "mobile";
  /** null = not found in the checked results. */
  position: number | null;
};

export type KeywordDrop = {
  keyword: string;
  device: "desktop" | "mobile";
  from: number;
  to: number | null;
};

/** Movements smaller than this are noise, not news. */
export const MIN_DROP_PLACES = 3;

/**
 * Keywords that got meaningfully worse between two checks.
 *
 * A drop is news when the keyword was ranking (top 20) and it either left the
 * results, fell off page one, or lost at least MIN_DROP_PLACES. A keyword that
 * was never ranking cannot drop, and one missing from either check is skipped
 * rather than guessed. Worst first: lost entirely, then by places lost.
 */
export function findKeywordDrops(
  previous: PositionSnapshot[],
  current: PositionSnapshot[],
): KeywordDrop[] {
  const before = new Map(
    previous.map((row) => [`${row.trackingKeywordId}:${row.device}`, row]),
  );

  const drops: KeywordDrop[] = [];
  for (const now of current) {
    const was = before.get(`${now.trackingKeywordId}:${now.device}`);
    if (!was || was.position === null || was.position > 20) continue;

    const from = was.position;
    const to = now.position;
    const lostEntirely = to === null;
    const leftPageOne = from <= 10 && to !== null && to > 10;
    const lostPlaces = to !== null && to - from >= MIN_DROP_PLACES;

    if (lostEntirely || leftPageOne || lostPlaces) {
      drops.push({ keyword: now.keyword, device: now.device, from, to });
    }
  }

  const severity = (drop: KeywordDrop) =>
    drop.to === null ? Number.MAX_SAFE_INTEGER : drop.to - drop.from;
  return drops.sort((a, b) => severity(b) - severity(a));
}

export function describeDrop(drop: KeywordDrop): string {
  const device = drop.device === "mobile" ? " (mobile)" : "";
  const to = drop.to === null ? "out of top 20" : `#${drop.to}`;
  return `${drop.keyword}${device}: #${drop.from} → ${to}`;
}
