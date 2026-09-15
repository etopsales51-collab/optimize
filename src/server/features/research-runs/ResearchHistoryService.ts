import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { researchHistoryLists } from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import type { ResearchHistoryListKey } from "@/shared/researchRuns";

/**
 * Each Research page's "Recent searches", per person and project, in the
 * database instead of one browser. The page owns the item shape and validates
 * it on read; the server only guarantees it stores a bounded JSON array for
 * the right person and project.
 */

/** Twenty history items are a few kilobytes; this leaves room and stops abuse. */
const MAX_ITEMS_JSON_BYTES = 64_000;

export async function getHistoryList(input: {
  userId: string;
  projectId: string;
  listKey: ResearchHistoryListKey;
}): Promise<string | null> {
  const [row] = await db
    .select({ itemsJson: researchHistoryLists.itemsJson })
    .from(researchHistoryLists)
    .where(
      and(
        eq(researchHistoryLists.userId, input.userId),
        eq(researchHistoryLists.projectId, input.projectId),
        eq(researchHistoryLists.listKey, input.listKey),
      ),
    )
    .limit(1);
  // null means "never saved", which is what triggers importing this browser's
  // old local history on first load.
  return row?.itemsJson ?? null;
}

export async function saveHistoryList(input: {
  userId: string;
  projectId: string;
  listKey: ResearchHistoryListKey;
  itemsJson: string;
}) {
  if (new TextEncoder().encode(input.itemsJson).length > MAX_ITEMS_JSON_BYTES) {
    throw new AppError("VALIDATION_ERROR", "History list is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.itemsJson);
  } catch {
    throw new AppError("VALIDATION_ERROR", "History list must be JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new AppError("VALIDATION_ERROR", "History list must be an array.");
  }

  const updatedAt = new Date().toISOString();
  await db
    .insert(researchHistoryLists)
    .values({
      userId: input.userId,
      projectId: input.projectId,
      listKey: input.listKey,
      itemsJson: input.itemsJson,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        researchHistoryLists.userId,
        researchHistoryLists.projectId,
        researchHistoryLists.listKey,
      ],
      set: { itemsJson: input.itemsJson, updatedAt },
    });
}

export const ResearchHistoryService = {
  getHistoryList,
  saveHistoryList,
} as const;
