import { describe, expect, it } from "vitest";
import { mergeHistoryLists } from "./historyMerge";

type Item = { keyword: string; timestamp: number };

const merge = (server: Item[], local: Item[], maxItems = 20) =>
  mergeHistoryLists({
    server,
    local,
    maxItems,
    getItemKey: (item) => item.timestamp,
    isSame: (a, b) => a.keyword === b.keyword,
  });

describe("mergeHistoryLists", () => {
  it("keeps searches from both the database and this browser, newest first", () => {
    const result = merge(
      [{ keyword: "canteen system", timestamp: 300 }],
      [{ keyword: "visitor management", timestamp: 400 }, { keyword: "time attendance", timestamp: 100 }],
    );
    expect(result.map((item) => item.keyword)).toEqual([
      "visitor management",
      "canteen system",
      "time attendance",
    ]);
  });

  it("collapses the same search to its newest entry", () => {
    const result = merge(
      [{ keyword: "canteen system", timestamp: 100 }],
      [{ keyword: "canteen system", timestamp: 500 }],
    );
    expect(result).toEqual([{ keyword: "canteen system", timestamp: 500 }]);
  });

  it("respects the page's history limit", () => {
    const local = Array.from({ length: 30 }, (_, i) => ({ keyword: `k${i}`, timestamp: i }));
    expect(merge([], local, 20)).toHaveLength(20);
  });
});
