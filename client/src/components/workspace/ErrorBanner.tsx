import { AlertOctagon, ChevronDown, Wand2 } from "lucide-react";
import { useState } from "react";
import type { FixRequest } from "@shared/events";
import { Button } from "../ui";

export const MAX_AUTO_FIX_ATTEMPTS = 2;

function summary(error: FixRequest): { title: string; message: string; details: string } {
  if (error.kind === "runtime-error") {
    return {
      title: "Runtime error in your app",
      message: error.message,
      details: [error.componentStack?.trim(), error.stack].filter(Boolean).join("\n\n"),
    };
  }
  return {
    title: "Your app failed to build",
    message: error.errors[0]?.message ?? "Build failed",
    details: error.errors
      .map((e) => `${e.file ?? "?"}${e.line ? `:${e.line}:${(e.column ?? 0) + 1}` : ""}  ${e.message}${e.lineText ? `\n    ${e.lineText.trim()}` : ""}`)
      .join("\n"),
  };
}

/** Shown over the preview when the generated app reports an error; hands it to the fixer agent. */
export default function ErrorBanner({
  error,
  onFix,
  fixing,
  autoFix,
  onAutoFixChange,
  attempts,
}: {
  error: FixRequest;
  onFix: () => void;
  fixing: boolean;
  autoFix: boolean;
  onAutoFixChange: (on: boolean) => void;
  attempts: number;
}) {
  const [open, setOpen] = useState(false);
  const { title, message, details } = summary(error);
  const exhausted = attempts >= MAX_AUTO_FIX_ATTEMPTS;

  return (
    <div
      role="alert"
      data-testid="error-banner"
      className="absolute inset-x-3 bottom-3 z-10 rounded-lg border border-red-900 bg-neutral-950/95 p-3 text-sm shadow-2xl backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <AlertOctagon className="mt-0.5 size-4 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-red-300">{title}</p>
          <p className="mt-0.5 line-clamp-3 break-words font-mono text-xs text-neutral-300" data-testid="error-message">
            {message}
          </p>
          {details && (
            <button onClick={() => setOpen((o) => !o)} className="mt-1 flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300">
              <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} /> Details
            </button>
          )}
          {open && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-neutral-900 p-2 font-mono text-[11px] text-neutral-400">
              {details}
            </pre>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button variant="primary" size="sm" onClick={onFix} loading={fixing} data-testid="fix-button">
            {!fixing && <Wand2 className="size-3.5" />} {fixing ? "Fixing…" : "Fix with AI"}
          </Button>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-400">
            <input
              type="checkbox"
              checked={autoFix}
              onChange={(e) => onAutoFixChange(e.target.checked)}
              className="accent-indigo-500"
              data-testid="autofix-toggle"
            />
            Auto-fix
          </label>
          {autoFix && exhausted && !fixing && (
            <span className="text-[11px] text-amber-400">Auto-fix paused after {attempts} tries</span>
          )}
        </div>
      </div>
    </div>
  );
}
