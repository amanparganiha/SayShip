import { eq, sql } from "drizzle-orm";
import type { GeneratedFile, GenerationMode } from "@shared/schemas";
import type { Db } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { generations, projects, usageEvents, type Generation } from "../db/schema";

export type NewGeneration = {
  projectId: number;
  mode: GenerationMode;
  instruction: string | null;
  summary: string | null;
  files: GeneratedFile[];
  model: string | null;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
};

/**
 * Appends the next version. Versions are immutable; "restore" and "fix" add new versions
 * rather than rewriting history. unique(project_id, version) makes a concurrent writer fail
 * instead of duplicating a version number, and we retry once with the new max.
 */
export async function saveGeneration(db: Db, input: NewGeneration): Promise<Generation> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ max: sql<number | null>`max(${generations.version})` })
          .from(generations)
          .where(eq(generations.projectId, input.projectId));
        const [gen] = await tx
          .insert(generations)
          .values({
            projectId: input.projectId,
            version: (row?.max ?? 0) + 1,
            mode: input.mode,
            instruction: input.instruction,
            summary: input.summary,
            files: input.files,
            model: input.model,
            promptTokens: input.promptTokens ?? 0,
            completionTokens: input.completionTokens ?? 0,
            durationMs: input.durationMs ?? 0,
          })
          .returning();
        await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, input.projectId));
        return gen!;
      });
    } catch (err) {
      if (attempt === 0 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

export async function recordUsage(
  db: Db,
  input: { userId: number; projectId: number; mode: GenerationMode; ok: boolean; promptTokens: number; completionTokens: number },
) {
  await db.insert(usageEvents).values(input);
}
