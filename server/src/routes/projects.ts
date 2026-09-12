import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { AppDeps } from "../app";
import { currentUser, requireAuth } from "../auth/middleware";
import { projects } from "../db/schema";
import { notFound } from "../lib/http";
import { randomKey } from "../lib/random";
import {
  getGeneration,
  getOwnedProject,
  listProjects,
  listVersions,
  nameFromPrompt,
  toProjectDetail,
  toVersionDetail,
} from "../services/projects";

const CreateProjectBody = z.object({
  prompt: z.string().trim().min(3, "Describe your app in a few words").max(2000, "Keep the prompt under 2000 characters"),
});

/** Route params that aren't positive integers are treated as "not found" rather than "bad request". */
export function parseId(raw: string | undefined, what = "Project"): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound(what);
  return n;
}

export function projectsRouter({ db }: AppDeps) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    res.json({ projects: await listProjects(db, currentUser(req).id) });
  });

  /** Creates the project row only; generation starts from the workspace via POST /:id/generate. */
  router.post("/", async (req, res) => {
    const { prompt } = CreateProjectBody.parse(req.body);
    const [project] = await db
      .insert(projects)
      .values({
        userId: currentUser(req).id,
        prompt,
        name: nameFromPrompt(prompt),
        previewKey: randomKey("prv"),
        liveKey: randomKey("live"),
      })
      .returning();
    res.status(201).json({ project: toProjectDetail(project!, null) });
  });

  router.get("/:id", async (req, res) => {
    const project = await getOwnedProject(db, currentUser(req).id, parseId(req.params.id));
    const versions = await listVersions(db, project.id);
    res.json({ project: toProjectDetail(project, versions.at(-1)?.version ?? null), versions });
  });

  router.delete("/:id", async (req, res) => {
    const deleted = await db
      .delete(projects)
      .where(and(eq(projects.id, parseId(req.params.id)), eq(projects.userId, currentUser(req).id)))
      .returning({ id: projects.id });
    if (deleted.length === 0) throw notFound("Project");
    res.status(204).end();
  });

  router.get("/:id/versions/:version", async (req, res) => {
    const project = await getOwnedProject(db, currentUser(req).id, parseId(req.params.id));
    const gen = await getGeneration(db, project.id, parseId(req.params.version, "Version"));
    res.json({ version: toVersionDetail(gen) });
  });

  return router;
}
