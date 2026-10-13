import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { wordpressPageDrafts } from "@/db/schema";

async function list(projectId: string) {
  return db
    .select()
    .from(wordpressPageDrafts)
    .where(eq(wordpressPageDrafts.projectId, projectId))
    .orderBy(desc(wordpressPageDrafts.updatedAt));
}

async function get(id: string, projectId: string) {
  const [row] = await db
    .select()
    .from(wordpressPageDrafts)
    .where(
      and(
        eq(wordpressPageDrafts.id, id),
        eq(wordpressPageDrafts.projectId, projectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function getBySlug(projectId: string, slug: string) {
  const [row] = await db
    .select()
    .from(wordpressPageDrafts)
    .where(
      and(
        eq(wordpressPageDrafts.projectId, projectId),
        eq(wordpressPageDrafts.slug, slug),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function create(
  projectId: string,
  title: string,
  slug: string,
  documentJson: string,
) {
  const now = new Date().toISOString();
  const [row] = await db
    .insert(wordpressPageDrafts)
    .values({
      id: crypto.randomUUID(),
      projectId,
      title,
      slug,
      documentJson,
      schemaVersion: "optimize-page-v1",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? getBySlug(projectId, slug);
}

async function updateLocal(
  id: string,
  projectId: string,
  input: {
    title: string;
    slug: string;
    documentJson: string;
    wpPageId?: number | null;
    remoteModifiedGmt?: string | null;
    previewUrl?: string | null;
    status?: "draft" | "publish";
  },
) {
  const [row] = await db
    .update(wordpressPageDrafts)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(wordpressPageDrafts.id, id),
        eq(wordpressPageDrafts.projectId, projectId),
      ),
    )
    .returning();
  return row ?? null;
}

export const PageEditorRepository = {
  list,
  get,
  getBySlug,
  create,
  updateLocal,
} as const;
