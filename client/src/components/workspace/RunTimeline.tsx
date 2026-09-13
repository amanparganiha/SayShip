import { AlertTriangle, Check, CircleX, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { GenerationMode } from "@shared/schemas";
import { formatMs } from "../../lib/format";
import { useWorkspace } from "../../lib/workspaceStore";
import { Button } from "../ui";

const TITLES: Record<GenerationMode, string> = {
  create: "Building your app",
  iterate: "Applying your change",
  fix: "Fixing the error",
  restore: "Restoring",
};

/** Live progress of the current (or last) run: phases, timing, errors. */
export default function RunTimeline({ onRetry }: { onRetry: () => void }) {
  const run = useWorkspace((s) => s.run);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (run?.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [run?.status]);

  if (!run) return null;
  const elapsed = (run.finishedAt ?? now) - run.startedAt;
  const running = run.status === "running";

  return (
    <section
      className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-sm"
      data-testid="run-timeline"
      data-status={run.status}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          {running ? (
            <Loader2 className="size-4 animate-spin text-indigo-400" />
          ) : run.status === "done" ? (
            <Check className="size-4 text-emerald-400" />
          ) : (
            <CircleX className="size-4 text-red-400" />
          )}
          {running ? TITLES[run.mode] : run.status === "done" ? "Done" : "Run failed"}
        </div>
        <span className="font-mono text-xs text-neutral-500">{formatMs(elapsed)}</span>
      </header>

      {run.editSummary && <p className="mb-2 text-xs text-neutral-300">{run.editSummary}</p>}

      <ol className="space-y-1">
        {run.log.map((entry, i) => {
          const current = running && i === run.log.length - 1;
          return (
            <li key={i} className={`flex items-center gap-2 text-xs ${current ? "text-neutral-200" : "text-neutral-500"}`}>
              {current ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              <span className="truncate">{entry.message}</span>
            </li>
          );
        })}
      </ol>

      {run.status === "done" && run.buildErrors.length > 0 && (
        <p className="mt-2 flex gap-1.5 text-xs text-amber-300">
          <AlertTriangle className="size-3.5 shrink-0" /> The build still fails. Use "Fix with AI" on the preview.
        </p>
      )}

      {run.status === "error" && run.error && (
        <div role="alert" className="mt-2 space-y-2 rounded-md border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">
          <p>{run.error.message}</p>
          {run.error.code !== "quota_exceeded" && (
            <Button size="sm" onClick={onRetry}>
              <RotateCcw className="size-3" /> Try again
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
