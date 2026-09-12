import type { FixRequest } from "@shared/events";
import { EditPlanSchema, ENTRY_FILE, normalizeAppPath, type EditPlan, type GeneratedFile, type Plan } from "@shared/schemas";
import type { LlmClient, UsageMeter } from "../llm/types";
import { EDITOR_SYSTEM } from "./prompts";

export type EditRequest = { kind: "instruction"; text: string } | FixRequest;

const MAX_CHANGES = 6;

/** Renders the change request the way the editor (and the writer) should read it. */
export function describeRequest(request: EditRequest): string {
  switch (request.kind) {
    case "instruction":
      return request.text;
    case "runtime-error":
      return [
        `The running app threw an error:\n${request.message}`,
        request.componentStack ? `React component stack:${request.componentStack}` : "",
        request.stack ? `Stack trace (bundled code, file names may be missing):\n${request.stack.split("\n").slice(0, 8).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    case "build-errors":
      return `The app failed to build:\n${request.errors
        .map((e) => `- ${e.file ?? "?"}${e.line ? `:${e.line}:${(e.column ?? 0) + 1}` : ""}: ${e.message}${e.lineText ? `\n    ${e.lineText.trim()}` : ""}`)
        .join("\n")}`;
  }
}

export async function planEdit(
  llm: LlmClient,
  input: { plan: Plan; files: GeneratedFile[]; request: EditRequest },
  opts: { signal?: AbortSignal; meter?: UsageMeter },
): Promise<EditPlan> {
  const { plan, files, request } = input;
  const heading = request.kind === "instruction" ? "Change requested by the user" : "Error report to fix";
  const user = [
    `App plan (JSON):\n${JSON.stringify(plan, null, 2)}`,
    `Current files:\n\n${files.map((f) => `--- ${f.path} ---\n${f.content.trimEnd()}\n`).join("\n")}`,
    `${heading}:\n${describeRequest(request)}`,
  ].join("\n\n");

  const raw = await llm.structured({
    schema: EditPlanSchema,
    name: "edit_plan",
    system: EDITOR_SYSTEM,
    user,
    trace: {
      step: "edit-plan",
      kind: request.kind,
      instruction: request.kind === "instruction" ? request.text : undefined,
    },
    ...opts,
  });
  return normalizeEditPlan(raw, files);
}

/**
 * Keeps only changes we can apply: valid paths, one change per file, no deleting the entry,
 * "modify" of a missing file becomes "create". Creates run first so later rewrites can import them.
 */
export function normalizeEditPlan(plan: EditPlan, files: GeneratedFile[]): EditPlan {
  const existing = new Set(files.map((f) => f.path));
  const byPath = new Map<string, EditPlan["changes"][number]>();

  for (const change of plan.changes) {
    const path = normalizeAppPath(change.path);
    if (!path) continue;
    let action = change.action;
    if (action === "delete" && (path === ENTRY_FILE || !existing.has(path))) continue;
    if (action === "modify" && !existing.has(path)) action = "create";
    if (action === "create" && existing.has(path)) action = "modify";
    byPath.set(path, { path, action, instructions: change.instructions.trim() });
  }

  const order = { create: 0, modify: 1, delete: 2 } as const;
  const changes = [...byPath.values()].sort((a, b) => order[a.action] - order[b.action]).slice(0, MAX_CHANGES);
  return { summary: plan.summary.trim().slice(0, 200) || "Updated the app", changes };
}
