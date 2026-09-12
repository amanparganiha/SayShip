import { and, eq, isNotNull } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import type { AppDeps } from "../app";
import { loadUser } from "../auth/middleware";
import { generations, projects, type Generation, type Project } from "../db/schema";
import { bundleGeneration, type BundleMode } from "../sandbox/bundle";
import { getRuntimeAssets } from "../sandbox/runtimeAssets";
import { messagePage, renderShell, sendSandboxed } from "../sandbox/shell";

const requestOrigin = (req: Request) => `${req.protocol}://${req.host}`;

async function sendApp(req: Request, res: Response, project: Project, gen: Generation, mode: BundleMode) {
  const [assets, bundle] = await Promise.all([getRuntimeAssets(), bundleGeneration(gen, mode)]);
  const html = renderShell({
    assets,
    bundle,
    mode,
    config: {
      apiBase: "",
      appKey: mode === "preview" ? project.previewKey : project.liveKey,
      env: mode,
      appName: project.plan?.appName ?? project.name,
    },
  });
  sendSandboxed(res, html, requestOrigin(req));
}

function sendMessage(res: Response, status: number, title: string, body: string) {
  res.status(status).set("Cache-Control", "no-store").type("html").send(messagePage(title, body));
}

/**
 * GET /preview/:projectId/:version  the owner's live preview (framed by the workspace)
 * GET /p/:slug                      a published app, public
 */
export function previewRouter({ db }: AppDeps) {
  const router = Router();

  router.get("/preview/:projectId/:version", loadUser(db), async (req, res) => {
    if (!req.user) {
      sendMessage(res, 401, "Sign in to view this preview", "Previews are private to the project owner.");
      return;
    }
    const projectId = Number(req.params.projectId);
    const version = Number(req.params.version);
    if (!Number.isSafeInteger(projectId) || !Number.isSafeInteger(version)) {
      sendMessage(res, 404, "Preview not found", "This version doesn't exist.");
      return;
    }

    const [row] = await db
      .select({ project: projects, gen: generations })
      .from(projects)
      .innerJoin(generations, and(eq(generations.projectId, projects.id), eq(generations.version, version)))
      .where(and(eq(projects.id, projectId), eq(projects.userId, req.user.id)))
      .limit(1);
    if (!row) {
      sendMessage(res, 404, "Preview not found", "This version doesn't exist.");
      return;
    }
    await sendApp(req, res, row.project, row.gen, "preview");
  });

  router.get("/p/:slug", async (req, res) => {
    const [row] = await db
      .select({ project: projects, gen: generations })
      .from(projects)
      .innerJoin(
        generations,
        and(eq(generations.projectId, projects.id), eq(generations.version, projects.publishedVersion)),
      )
      .where(and(eq(projects.publishedSlug, req.params.slug), isNotNull(projects.publishedVersion)))
      .limit(1);
    if (!row) {
      sendMessage(res, 404, "App not found", "This app isn't published (anymore).");
      return;
    }
    await sendApp(req, res, row.project, row.gen, "live");
  });

  return router;
}
