import { describe, expect, it } from "vitest";
import {
  chooseSendMode,
  findKeywordDrops,
  formatAlert,
  MAX_BODY_CHARS,
  normalizePhone,
  phonesMatch,
  type PositionSnapshot,
} from "./whatsappRules";

describe("phone matching", () => {
  it("normalizes the forms Twilio and people send", () => {
    expect(normalizePhone("whatsapp:+971 50-123 4567")).toBe("971501234567");
    expect(normalizePhone("00971501234567")).toBe("971501234567");
    expect(normalizePhone("12")).toBeNull();
  });

  it("matches a local number to the same number with a country code", () => {
    expect(phonesMatch("0501234567", "whatsapp:+971501234567")).toBe(true);
  });

  it("does not match different subscribers in the same country", () => {
    expect(phonesMatch("+971501234567", "+971501234568")).toBe(false);
  });
});

describe("chooseSendMode", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("sends free-form inside the 24-hour window", () => {
    expect(chooseSendMode("2026-09-14T01:00:00.000Z", "HX123", now)).toBe(
      "freeform",
    );
  });

  it("uses the template outside the window when one is configured", () => {
    expect(chooseSendMode("2026-09-12T12:00:00.000Z", "HX123", now)).toBe(
      "template",
    );
    expect(chooseSendMode(null, "HX123", now)).toBe("template");
  });

  it("still attempts free-form without a template, so Twilio's reason is recorded", () => {
    expect(chooseSendMode(null, undefined, now)).toBe("freeform");
  });
});

describe("findKeywordDrops", () => {
  const row = (
    id: string,
    position: number | null,
    device: "desktop" | "mobile" = "desktop",
  ): PositionSnapshot => ({
    trackingKeywordId: id,
    keyword: `kw-${id}`,
    device,
    position,
  });

  it("reports only meaningful drops, worst first", () => {
    const drops = findKeywordDrops(
      [row("a", 4), row("b", 8), row("c", 5), row("d", 15), row("e", 30)],
      [row("a", null), row("b", 12), row("c", 6), row("d", 19), row("e", null)],
    );

    // a left the results, d lost 4 places, b fell off page one (lost 4 too).
    // c moved one place and e was never ranking: neither is news.
    expect(drops.map((d) => d.keyword)).toEqual(["kw-a", "kw-b", "kw-d"]);
  });

  it("compares desktop with desktop and mobile with mobile", () => {
    const drops = findKeywordDrops(
      [row("a", 3, "desktop"), row("a", 3, "mobile")],
      [row("a", 3, "desktop"), row("a", 9, "mobile")],
    );
    expect(drops).toEqual([
      { keyword: "kw-a", device: "mobile", from: 3, to: 9 },
    ]);
  });

  it("ignores a keyword with no earlier check", () => {
    expect(findKeywordDrops([], [row("a", null)])).toEqual([]);
  });
});

describe("formatAlert", () => {
  it("puts the project first and folds extra lines into a count", () => {
    const text = formatAlert({
      projectName: "Ubio",
      headline: "3 keywords dropped",
      lines: ["one", "two", "three"],
      maxLines: 2,
      link: "https://seo.deepinsights.space/p/1/rank-tracking",
    });

    expect(text.startsWith("*Ubio* · 3 keywords dropped")).toBe(true);
    expect(text).toContain("• two");
    expect(text).not.toContain("• three");
    expect(text).toContain("+1 more");
  });

  it("never exceeds WhatsApp's message size", () => {
    const text = formatAlert({
      projectName: "Ubio",
      headline: "long",
      lines: [Array.from({ length: 400 }, () => "word").join(" ")],
    });
    expect(text.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
  });
});
