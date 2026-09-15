import { useCallback, useEffect, useRef, useState } from "react";
import { mergeHistoryLists } from "@/client/hooks/historyMerge";
import {
  getResearchHistoryList,
  saveResearchHistoryList,
} from "@/serverFunctions/researchRuns";
import { parseHistoryStorageKey } from "@/shared/researchRuns";

/**
 * Recent-searches store for the Research pages.
 *
 * Despite the name, the lists are kept in the DATABASE, per person and project,
 * so they follow the person to any PC and survive a cleared browser. The name
 * and signature are unchanged so every page and history component works as
 * before.
 *
 * - Load: from the server. On the first load in a browser, anything that
 *   browser still holds in localStorage is merged in and saved, once.
 * - Change: state updates immediately and the whole list is saved to the
 *   server. A local copy is also kept, used only if the server cannot be
 *   reached.
 * - A storage key that is not a known history list keeps the old local-only
 *   behaviour.
 */

type UseLocalHistoryStoreOptions<TItem, TAddInput> = {
  storageKey: string;
  maxItems?: number;
  parse: (raw: string) => TItem[] | null;
  isSameItem: (existing: TItem, next: TAddInput) => boolean;
  createItem: (input: TAddInput) => TItem;
  getItemKey: (item: TItem) => number;
};

function loadHistory<TItem>(
  storageKey: string,
  parse: (raw: string) => TItem[] | null,
  maxItems: number,
): TItem[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];

    const parsed = parse(raw);
    return parsed ? parsed.slice(0, maxItems) : [];
  } catch {
    return [];
  }
}

function saveLocal<TItem>(storageKey: string, items: TItem[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    // storage full or unavailable - silently ignore
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return true;
  }
}

function writeFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // unavailable: the merge may run again next load, which is harmless
  }
}

export function useLocalHistoryStore<TItem, TAddInput>({
  storageKey,
  maxItems = 20,
  parse,
  isSameItem,
  createItem,
  getItemKey,
}: UseLocalHistoryStoreOptions<TItem, TAddInput>) {
  const parseRef = useRef(parse);
  const getItemKeyRef = useRef(getItemKey);
  const isSameItemRef = useRef(isSameItem);
  const historyRef = useRef<TItem[]>([]);
  // Until the saved list has loaded, a change is only shown: saving it then
  // could replace the stored list before it was read. The load merges it in.
  // If the server cannot be reached, changes are kept in this browser only.
  const saveToRef = useRef<"pending" | "server" | "browser">("pending");
  const [history, setHistory] = useState<TItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    parseRef.current = parse;
    getItemKeyRef.current = getItemKey;
    isSameItemRef.current = isSameItem;
  }, [parse, getItemKey, isSameItem]);

  const show = useCallback((items: TItem[]) => {
    historyRef.current = items;
    setHistory(items);
  }, []);

  /** Show a changed list and save it: the database first, this browser as a fallback copy. */
  const commit = useCallback(
    (items: TItem[]) => {
      show(items);
      if (saveToRef.current === "pending") return;
      saveLocal(storageKey, items);
      const synced = parseHistoryStorageKey(storageKey);
      if (!synced || saveToRef.current !== "server") return;
      void saveResearchHistoryList({
        data: {
          projectId: synced.projectId,
          listKey: synced.listKey,
          itemsJson: JSON.stringify(items),
        },
      }).catch(() => {
        // Kept in this browser; the next change saves the whole list again.
      });
    },
    [show, storageKey],
  );

  useEffect(() => {
    let cancelled = false;
    const local = loadHistory(storageKey, parseRef.current, maxItems);
    const synced = parseHistoryStorageKey(storageKey);
    saveToRef.current = "pending";
    show([]);

    if (!synced) {
      saveToRef.current = "browser";
      show(local);
      setIsLoaded(true);
      return;
    }

    setIsLoaded(false);
    getResearchHistoryList({
      data: { projectId: synced.projectId, listKey: synced.listKey },
    })
      .then(({ itemsJson }) => {
        if (cancelled) return;
        const server = itemsJson ? (parseRef.current(itemsJson) ?? []) : [];
        const importedFlag = `${storageKey}:imported-to-db`;
        const importLocal = !readFlag(importedFlag) && local.length > 0;
        // Searches run while the list was loading are kept too.
        const addedWhileLoading = historyRef.current;
        saveToRef.current = "server";

        if (importLocal || addedWhileLoading.length > 0) {
          commit(
            mergeHistoryLists({
              server,
              local: [...addedWhileLoading, ...(importLocal ? local : [])],
              maxItems,
              getItemKey: getItemKeyRef.current,
              // History items carry every field the add input has, so the
              // page's own sameness rule applies to them directly.
              isSame: (a, b) =>
                isSameItemRef.current(a, b as unknown as TAddInput),
            }),
          );
        } else {
          show(server.slice(0, maxItems));
        }
        writeFlag(importedFlag);
        setIsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Server unreachable: show what this browser has rather than nothing.
        saveToRef.current = "browser";
        commit(
          mergeHistoryLists({
            server: local,
            local: historyRef.current,
            maxItems,
            getItemKey: getItemKeyRef.current,
            isSame: (a, b) =>
              isSameItemRef.current(a, b as unknown as TAddInput),
          }),
        );
        setIsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [maxItems, storageKey, commit, show]);

  const addItem = useCallback(
    (input: TAddInput) => {
      const filtered = historyRef.current.filter(
        (existing) => !isSameItem(existing, input),
      );
      commit([createItem(input), ...filtered].slice(0, maxItems));
    },
    [commit, createItem, isSameItem, maxItems],
  );

  const removeItem = useCallback(
    (itemKey: number) => {
      commit(
        historyRef.current.filter((item) => getItemKey(item) !== itemKey),
      );
    },
    [commit, getItemKey],
  );

  const clearItems = useCallback(() => {
    commit([]);
  }, [commit]);

  return { history, isLoaded, addItem, removeItem, clearItems };
}
