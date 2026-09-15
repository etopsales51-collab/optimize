/**
 * Merge a browser's old local history into the list stored in the database,
 * once, when a page first loads after history moved server-side. Nothing the
 * person searched on this PC is lost, and nothing already saved is dropped.
 *
 * Newest first by item key (a timestamp in every history hook), duplicates of
 * the same search collapsed to the newest, capped at the page's limit.
 */
export function mergeHistoryLists<TItem>(input: {
  server: TItem[];
  local: TItem[];
  getItemKey: (item: TItem) => number;
  isSame: (a: TItem, b: TItem) => boolean;
  maxItems: number;
}): TItem[] {
  const all = [...input.server, ...input.local].sort(
    (a, b) => input.getItemKey(b) - input.getItemKey(a),
  );
  const merged: TItem[] = [];
  for (const item of all) {
    if (merged.some((kept) => input.isSame(kept, item))) continue;
    merged.push(item);
    if (merged.length >= input.maxItems) break;
  }
  return merged;
}
