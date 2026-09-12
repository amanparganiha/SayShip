import type { RunEvent } from "@shared/events";
import type { EditPlan, GeneratedFile, Plan } from "@shared/schemas";
import type { LlmClient, UsageMeter } from "../llm/types";
import { bundleApp } from "../sandbox/bundle";
import { planEdit, describeRequest, type EditRequest } from "./editor";
import { planApp } from "./planner";
import { FenceFilter, stripFences, writeFile } from "./writer";

export type RunContext = {
  llm: LlmClient;
  emit: (event: RunEvent) => void;
  signal: AbortSignal;
  meter: UsageMeter;
};

export type RunResult = { plan: Plan; files: GeneratedFile[]; summary: string };

export class PipelineError extends Error {}

/**
 * create: prompt -> plan (structured output) -> each file streamed in dependency order
 *         -> build check -> one self-repair pass if the build fails.
 */
export async function runCreate(ctx: RunContext, input: { prompt: string }): Promise<RunResult> {
  const opts = { signal: ctx.signal, meter: ctx.meter };

  ctx.emit({ type: "status", phase: "planning", message: "Planning the app" });
  const plan = await planApp(ctx.llm, input.prompt, opts);
  ctx.emit({ type: "plan", plan });

  const files: GeneratedFile[] = [];
  for (const file of plan.files) {
    ctx.emit({ type: "status", phase: "writing", message: `Writing ${file.path}` });
    const content = await streamFile(ctx, {
      plan,
      files,
      path: file.path,
      action: "create",
      instructions: file.purpose,
      prompt: input.prompt,
    });
    files.push({ path: file.path, content });
  }

  const checked = await checkAndRepair(ctx, { plan, files, prompt: input.prompt });
  return { plan, files: checked, summary: `Generated ${plan.appName}` };
}

/** iterate / fix: editor decides the changes -> changed files rewritten (streamed) -> build check. */
export async function runEdit(
  ctx: RunContext,
  input: { plan: Plan; files: GeneratedFile[]; request: EditRequest; prompt: string },
): Promise<RunResult> {
  ctx.emit({ type: "status", phase: "planning", message: "Deciding what to change" });
  const { files, summary } = await applyEdit(ctx, input);
  const checked = await checkAndRepair(ctx, { plan: input.plan, files, prompt: input.prompt });
  return { plan: input.plan, files: checked, summary };
}

async function applyEdit(
  ctx: RunContext,
  input: { plan: Plan; files: GeneratedFile[]; request: EditRequest; prompt: string },
): Promise<{ files: GeneratedFile[]; summary: string }> {
  const opts = { signal: ctx.signal, meter: ctx.meter };
  const editPlan: EditPlan = await planEdit(ctx.llm, input, opts);
  if (editPlan.changes.length === 0) throw new PipelineError("The agent couldn't find anything to change.");
  ctx.emit({ type: "edit_plan", summary: editPlan.summary, changes: editPlan.changes });

  const current = new Map(input.files.map((f) => [f.path, f]));
  const snapshot = () => [...current.values()];
  const isFix = input.request.kind !== "instruction";

  for (const change of editPlan.changes) {
    if (change.action === "delete") {
      current.delete(change.path);
      ctx.emit({ type: "file_deleted", path: change.path });
      continue;
    }
    ctx.emit({ type: "status", phase: "writing", message: `${change.action === "create" ? "Creating" : "Updating"} ${change.path}` });
    const content = await streamFile(ctx, {
      plan: input.plan,
      files: snapshot(),
      path: change.path,
      action: change.action,
      instructions: change.instructions,
      prompt: input.prompt,
      changeRequest: describeRequest(input.request),
      changeSummary: editPlan.summary,
      fix: isFix,
    });
    current.set(change.path, { path: change.path, content });
  }
  return { files: snapshot(), summary: editPlan.summary };
}

async function streamFile(ctx: RunContext, task: Parameters<typeof writeFile>[1]): Promise<string> {
  ctx.emit({ type: "file_start", path: task.path, action: task.action });
  const filter = new FenceFilter();
  let raw = "";
  for await (const delta of writeFile(ctx.llm, task, { signal: ctx.signal, meter: ctx.meter })) {
    raw += delta;
    const visible = filter.push(delta);
    if (visible) ctx.emit({ type: "file_delta", path: task.path, delta: visible });
  }
  const content = stripFences(raw);
  if (content.trim().length === 0) throw new PipelineError(`The model returned an empty ${task.path}.`);
  ctx.emit({ type: "file_done", path: task.path, content });
  return content;
}

/**
 * Compiles with the same bundler the preview uses. On failure the editor gets the errors
 * (file:line + message) for one repair pass. If that still fails, the version is saved anyway:
 * the preview shows the build error and the user can hit "Fix with AI" again.
 */
async function checkAndRepair(
  ctx: RunContext,
  input: { plan: Plan; files: GeneratedFile[]; prompt: string },
): Promise<GeneratedFile[]> {
  ctx.emit({ type: "status", phase: "checking", message: "Checking that the app builds" });
  const first = await bundleApp(input.files, "preview");
  ctx.emit({ type: "check", ok: first.ok, errors: first.ok ? [] : first.errors });
  if (first.ok) return input.files;

  ctx.emit({ type: "status", phase: "repairing", message: "Build failed, repairing" });
  const repaired = await applyEdit(ctx, { ...input, request: { kind: "build-errors", errors: first.errors } });
  const second = await bundleApp(repaired.files, "preview");
  ctx.emit({ type: "check", ok: second.ok, errors: second.ok ? [] : second.errors });
  return repaired.files;
}
