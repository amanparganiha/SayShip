import { create } from "zustand";
import type { VersionDetail } from "@shared/api";
import type { FixRequest, RunEvent, RunPhase } from "@shared/events";
import type { BuildErrorInfo } from "@shared/preview";
import type { GenerationMode, Plan } from "@shared/schemas";

export type FileStatus = "pending" | "streaming" | "done" | "changed";

export type RunLogEntry = { at: number; phase: RunPhase; message: string };

export type RunState = {
  mode: GenerationMode;
  status: "running" | "done" | "error";
  phase: RunPhase;
  log: RunLogEntry[];
  startedAt: number;
  finishedAt: number | null;
  error: { code: string; message: string } | null;
  editSummary: string | null;
  buildErrors: BuildErrorInfo[];
};

export type PreviewStatus = "idle" | "loading" | "ready" | "error";

type State = {
  projectId: number | null;
  plan: Plan | null;
  /** Files shown in the tree/code viewer: the viewed version, or the in-flight run's output. */
  files: Record<string, string>;
  order: string[];
  status: Record<string, FileStatus>;
  selected: string | null;
  /** Code viewer jumps to whichever file is being written. */
  follow: boolean;
  /** Version shown in the code viewer and preview. */
  viewing: number | null;
  /** Version whose files are currently in `files` (lags `viewing` while its files load). */
  loaded: number | null;
  run: RunState | null;
  preview: { status: PreviewStatus; error: FixRequest | null; nonce: number };
  autoFix: boolean;
  /** Consecutive automatic fix attempts; reset by a clean preview or a manual change. */
  autoFixAttempts: number;
};

type Actions = {
  reset: (projectId: number, plan: Plan | null) => void;
  view: (version: number) => void;
  showVersion: (version: VersionDetail) => void;
  select: (path: string) => void;
  setFollow: (follow: boolean) => void;
  applyEvent: (event: RunEvent) => void;
  appendDeltas: (deltas: Map<string, string>) => void;
  failRun: (error: { code: string; message: string }) => void;
  setPreviewStatus: (status: PreviewStatus, error?: FixRequest | null) => void;
  reloadPreview: () => void;
  setAutoFix: (on: boolean) => void;
  countAutoFix: () => void;
};

const sortPaths = (paths: string[]) =>
  [...paths].sort((a, b) => {
    if (a === "App.jsx") return 1;
    if (b === "App.jsx") return -1;
    return a.localeCompare(b);
  });

const initial: State = {
  projectId: null,
  plan: null,
  files: {},
  order: [],
  status: {},
  selected: null,
  follow: true,
  viewing: null,
  loaded: null,
  run: null,
  preview: { status: "idle", error: null, nonce: 0 },
  autoFix: true,
  autoFixAttempts: 0,
};

export const useWorkspace = create<State & Actions>()((set, get) => ({
  ...initial,

  reset: (projectId, plan) => set({ ...initial, projectId, plan, autoFix: get().autoFix }),

  view: (version) =>
    set((s) =>
      s.viewing === version ? {} : { viewing: version, preview: { status: "loading", error: null, nonce: s.preview.nonce } },
    ),

  showVersion: (version) =>
    set((s) => {
      const files = Object.fromEntries(version.files.map((f) => [f.path, f.content]));
      const order = sortPaths(Object.keys(files));
      const selected = s.selected && files[s.selected] !== undefined ? s.selected : (order.at(-1) ?? null);
      const status = Object.fromEntries(order.map((p) => [p, "done" as const]));
      return { files, order, status, selected, loaded: version.version };
    }),

  select: (path) => set({ selected: path, follow: false }),
  setFollow: (follow) => set({ follow }),

  applyEvent: (event) =>
    set((s) => {
      const run = s.run;
      switch (event.type) {
        case "run":
          return {
            run: {
              mode: event.mode,
              status: "running",
              phase: "planning",
              log: [],
              startedAt: Date.now(),
              finishedAt: null,
              error: null,
              editSummary: null,
              buildErrors: [],
            },
            // A brand-new app starts from an empty file tree.
            ...(event.mode === "create" ? { files: {}, order: [], status: {}, selected: null } : {}),
            follow: true,
          };
        case "status":
          if (!run) return {};
          return {
            run: { ...run, phase: event.phase, log: [...run.log, { at: Date.now(), phase: event.phase, message: event.message }] },
          };
        case "plan": {
          const order = event.plan.files.map((f) => f.path);
          return { plan: event.plan, order, status: Object.fromEntries(order.map((p) => [p, "pending" as const])) };
        }
        case "edit_plan": {
          const status = { ...s.status };
          for (const c of event.changes) if (c.action !== "delete") status[c.path] = "pending";
          return { run: run && { ...run, editSummary: event.summary }, status };
        }
        case "file_start": {
          const order = s.order.includes(event.path) ? s.order : sortPaths([...s.order, event.path]);
          return {
            files: { ...s.files, [event.path]: "" },
            order,
            status: { ...s.status, [event.path]: "streaming" },
            selected: s.follow ? event.path : s.selected,
          };
        }
        case "file_delta":
          return { files: { ...s.files, [event.path]: (s.files[event.path] ?? "") + event.delta } };
        case "file_done":
          return {
            files: { ...s.files, [event.path]: event.content },
            status: { ...s.status, [event.path]: run?.mode === "create" ? "done" : "changed" },
          };
        case "file_deleted": {
          const files = { ...s.files };
          delete files[event.path];
          return {
            files,
            order: s.order.filter((p) => p !== event.path),
            selected: s.selected === event.path ? (s.order.at(-1) ?? null) : s.selected,
          };
        }
        case "check":
          return { run: run && { ...run, buildErrors: event.ok ? [] : event.errors } };
        case "done":
          // The streamed files *are* the new version, so it counts as loaded (keeps "changed" markers).
          return {
            run: run && { ...run, status: "done", finishedAt: Date.now() },
            plan: event.project.plan ?? s.plan,
            viewing: event.version.version,
            loaded: event.version.version,
            preview: { status: "loading", error: null, nonce: s.preview.nonce + 1 },
          };
        case "error":
          return { run: run && { ...run, status: "error", finishedAt: Date.now(), error: { code: event.code, message: event.message } } };
      }
    }),

  // Deltas arrive faster than the screen refreshes; the workspace batches them per animation frame.
  appendDeltas: (deltas) =>
    set((s) => {
      const files = { ...s.files };
      for (const [path, text] of deltas) files[path] = (files[path] ?? "") + text;
      return { files };
    }),

  failRun: (error) =>
    set((s) => ({
      run: {
        ...(s.run ?? {
          mode: "iterate" as const,
          phase: "planning" as const,
          log: [],
          startedAt: Date.now(),
          editSummary: null,
          buildErrors: [],
        }),
        status: "error",
        finishedAt: Date.now(),
        error,
      },
    })),

  setPreviewStatus: (status, error = null) =>
    set((s) => ({
      // The first error of a page load is usually the root cause; later ones are fallout.
      preview: { ...s.preview, status, error: status === "error" ? (s.preview.error ?? error) : error },
      // A clean render means the last fix worked: allow future automatic fixes again.
      autoFixAttempts: status === "ready" ? 0 : s.autoFixAttempts,
    })),

  reloadPreview: () => set((s) => ({ preview: { status: "loading", error: null, nonce: s.preview.nonce + 1 } })),
  setAutoFix: (on) => set({ autoFix: on }),
  countAutoFix: () => set((s) => ({ autoFixAttempts: s.autoFixAttempts + 1 })),
}));
