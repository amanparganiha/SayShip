import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { RunEvent } from "@shared/events";
import type { GeneratedFile, Plan } from "@shared/schemas";
import { PipelineError, runCreate, runEdit, type RunResult } from "../agent/pipeline";
import type { EditRequest } from "../agent/editor";
import type { AppDeps } from "../app";
import { currentUser, requireAuth } from "../auth/middleware";
import { projects, type Project } from "../db/schema";
import { describeProviderError } from "../llm/openai";
import { LlmError, UsageMeter } from "../llm/types";
import { HttpError } from "../lib/http";
import { acquireRunLease, releaseRunLease } from "../lib/lease";
import { getUsage } from "../lib/quota";
import { openSse } from "../lib/sse";
import { recordUsage, saveGeneration } from "../services/generations";
import {
  getGeneration,
  getLatestGeneration,
  getOwnedProject,
  toProjectDetail,
  toVersionSummary,
} from "../services/projects";
import { parseId } from "./projects";

const RUN_TIMEOUT_MS = 5 * 60_000;

const BuildErrorSchema = z.object({
  file: z.string().max(200).nullable(),
  line: z.number().int().nullable(),
  column: z.number().int().nullable(),
  lineText: z.string().max(1000).nullable(),
  message: z.string().max(2000),
});

const FixRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("runtime-error"),
    message: z.string().min(1).max(4000),
    stack: z.string().max(8000).optional(),
    componentStack: z.string().max(8000).optional(),
  }),
  z.object({ kind: z.literal("build-errors"), errors: z.array(BuildErrorSchema).min(1).max(20) }),
]);

const GenerateBody = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("create") }),
  z.object({
    mode: z.literal("iterate"),
    instruction: z.string().trim().min(3, "Describe the change in a few words").max(2000),
    baseVersion: z.number().int().positive().optional(),
  }),
  z.object({
    mode: z.literal("fix"),
    error: FixRequestSchema,
    baseVersion: z.number().int().positive().optional(),
  }),
]);

/** Plan for projects created before plans existed or whose plan was lost: derived from files. */
const fallbackPlan = (project: Project, files: GeneratedFile[]): Plan => ({
  appName: project.name,
  description: project.prompt,
  entities: [],
  features: [],
  files: files.map((f) => ({ path: f.path, purpose: "Existing file" })),
});

function describeRunError(err: unknown, model: string, signal: AbortSignal): { code: string; message: string } {
  if (signal.aborted) return { code: "timeout", message: "The run took too long and was stopped. Try again." };
  const provider = describeProviderError(err, model);
  if (provider) return provider;
  if (err instanceof LlmError) return { code: `llm_${err.code}`, message: err.message };
  if (err instanceof PipelineError) return { code: "pipeline", message: err.message };
  console.error("[generate] unexpected error", err);
  return { code: "internal", message: "Generation failed unexpectedly. Please try again." };
}

export function generateRouter({ db, env, llm }: AppDeps) {
  const router = Router();
  router.use(requireAuth);

  /**
   * Runs one agent pass and streams its progress as Server-Sent Events.
   * Pre-flight failures (auth, validation, quota, a run already in progress) are plain JSON errors.
   */
  router.post("/:id/generate", async (req, res) => {
    const user = currentUser(req);
    const project = await getOwnedProject(db, user.id, parseId(req.params.id));
    const body = GenerateBody.parse(req.body);

    const latest = await getLatestGeneration(db, project.id);
    if (body.mode === "create" && latest) {
      throw new HttpError(409, "already_generated", "This app is already generated. Describe a change instead.");
    }
    if (body.mode !== "create" && !latest) throw new HttpError(409, "nothing_to_edit", "Generate the app first.");
    const base = body.mode !== "create" && body.baseVersion ? await getGeneration(db, project.id, body.baseVersion) : latest;

    const usage = await getUsage(db, env, user);
    if (usage.remaining <= 0) {
      throw new HttpError(429, "quota_exceeded", `You've used all ${usage.limit} generation runs for the last 24 hours.`);
    }
    if (!(await acquireRunLease(db, project.id))) {
      throw new HttpError(409, "run_in_progress", "A generation is already running for this project.");
    }

    const sse = openSse(res);
    const clientGone = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) clientGone.abort(new Error("client disconnected"));
    });
    const timeout = AbortSignal.timeout(RUN_TIMEOUT_MS);
    const signal = AbortSignal.any([clientGone.signal, timeout]);
    const meter = new UsageMeter();
    const started = Date.now();
    let ok = false;

    const emit = (event: RunEvent) => sse.send(event);
    try {
      emit({ type: "run", mode: body.mode, projectId: project.id, baseVersion: base?.version ?? null });
      const ctx = { llm, emit, signal, meter };

      let result: RunResult;
      let instruction: string | null = null;
      if (body.mode === "create") {
        result = await runCreate(ctx, { prompt: project.prompt });
      } else {
        const request: EditRequest = body.mode === "iterate" ? { kind: "instruction", text: body.instruction } : body.error;
        instruction = body.mode === "iterate" ? body.instruction : body.error.kind === "runtime-error" ? body.error.message : "Build errors";
        result = await runEdit(ctx, {
          plan: project.plan ?? fallbackPlan(project, base!.files),
          files: base!.files,
          request,
          prompt: project.prompt,
        });
      }

      emit({ type: "status", phase: "saving", message: "Saving the new version" });
      const gen = await saveGeneration(db, {
        projectId: project.id,
        mode: body.mode,
        instruction: instruction?.slice(0, 2000) ?? null,
        summary: result.summary,
        files: result.files,
        model: llm.model,
        promptTokens: meter.promptTokens,
        completionTokens: meter.completionTokens,
        durationMs: Date.now() - started,
      });
      // The first version names the project after the plan; later runs keep both.
      const [updated] =
        body.mode === "create"
          ? await db
              .update(projects)
              .set({ name: result.plan.appName, plan: result.plan })
              .where(eq(projects.id, project.id))
              .returning()
          : await db.select().from(projects).where(eq(projects.id, project.id));
      ok = true;
      emit({ type: "done", version: toVersionSummary(gen), project: toProjectDetail(updated ?? project, gen.version) });
    } catch (err) {
      if (!clientGone.signal.aborted) emit({ type: "error", ...describeRunError(err, llm.model, timeout) });
    } finally {
      await releaseRunLease(db, project.id);
      await recordUsage(db, {
        userId: user.id,
        projectId: project.id,
        mode: body.mode,
        ok,
        promptTokens: meter.promptTokens,
        completionTokens: meter.completionTokens,
      });
      sse.close();
    }
  });

  /** Restoring never rewrites history: the old files become a new version. No LLM involved. */
  router.post("/:id/versions/:version/restore", async (req, res) => {
    const project = await getOwnedProject(db, currentUser(req).id, parseId(req.params.id));
    const source = await getGeneration(db, project.id, parseId(req.params.version, "Version"));
    const gen = await saveGeneration(db, {
      projectId: project.id,
      mode: "restore",
      instruction: null,
      summary: `Restored v${source.version}`,
      files: source.files,
      model: null,
    });
    res.status(201).json({ version: toVersionSummary(gen) });
  });

  return router;
}
