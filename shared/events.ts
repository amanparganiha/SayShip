import type { ProjectDetail, VersionSummary } from "./api";
import type { BuildErrorInfo } from "./preview";
import type { EditPlan, GenerationMode, Plan } from "./schemas";

/** Server-sent events emitted by POST /api/projects/:id/generate, in order. */

export type RunPhase = "planning" | "writing" | "checking" | "repairing" | "saving";

export type RunEvent =
  | { type: "run"; mode: GenerationMode; projectId: number; baseVersion: number | null }
  | { type: "status"; phase: RunPhase; message: string }
  | { type: "plan"; plan: Plan }
  | { type: "edit_plan"; summary: string; changes: EditPlan["changes"] }
  | { type: "file_start"; path: string; action: "create" | "modify" }
  | { type: "file_delta"; path: string; delta: string }
  | { type: "file_done"; path: string; content: string }
  | { type: "file_deleted"; path: string }
  | { type: "check"; ok: boolean; errors: BuildErrorInfo[] }
  | { type: "done"; version: VersionSummary; project: ProjectDetail }
  | { type: "error"; code: string; message: string };

export type RunEventType = RunEvent["type"];

/** What the workspace asks the agent to fix, captured from the preview. */
export type FixRequest =
  | { kind: "runtime-error"; message: string; stack?: string; componentStack?: string }
  | { kind: "build-errors"; errors: BuildErrorInfo[] };

export type GenerateRequest =
  | { mode: "create" }
  | { mode: "iterate"; instruction: string; baseVersion?: number }
  | { mode: "fix"; error: FixRequest; baseVersion?: number };
