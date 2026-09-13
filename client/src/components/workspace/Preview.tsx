import clsx from "clsx";
import { ExternalLink, Loader2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isPreviewMessage } from "@shared/preview";
import { useWorkspace } from "../../lib/workspaceStore";
import DataPanel from "./DataPanel";
import ErrorBanner from "./ErrorBanner";

/**
 * The live app, in an opaque-origin sandbox (no allow-same-origin): it can't touch SayShip's
 * cookies or API. It talks to us only through postMessage (ready / runtime-error / build-error),
 * which is checked by source window, since a sandboxed frame's origin is "null".
 */
export default function Preview({
  projectId,
  published,
  onFix,
}: {
  projectId: number;
  published: boolean;
  onFix: () => void;
}) {
  const viewing = useWorkspace((s) => s.viewing);
  const preview = useWorkspace((s) => s.preview);
  const run = useWorkspace((s) => s.run);
  const autoFix = useWorkspace((s) => s.autoFix);
  const attempts = useWorkspace((s) => s.autoFixAttempts);
  const setAutoFix = useWorkspace((s) => s.setAutoFix);
  const setPreviewStatus = useWorkspace((s) => s.setPreviewStatus);
  const reloadPreview = useWorkspace((s) => s.reloadPreview);
  const [tab, setTab] = useState<"app" | "data">("app");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      if (!isPreviewMessage(event.data)) return;
      const msg = event.data;
      if (msg.type === "ready") setPreviewStatus("ready");
      else if (msg.type === "runtime-error") {
        setPreviewStatus("error", {
          kind: "runtime-error",
          message: String(msg.message).slice(0, 4000),
          stack: msg.stack?.slice(0, 8000),
          componentStack: msg.componentStack?.slice(0, 8000),
        });
      } else setPreviewStatus("error", { kind: "build-errors", errors: msg.errors.slice(0, 20) });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [setPreviewStatus]);

  const running = run?.status === "running";
  const fixing = running && run.mode === "fix";
  const src = viewing ? `/preview/${projectId}/${viewing}` : null;

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-800 px-2">
        {(["app", "data"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-testid={`tab-${t}`}
            className={clsx("rounded px-2 py-0.5 text-xs", tab === t ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-neutral-200")}
          >
            {t === "app" ? "Preview" : "Data"}
          </button>
        ))}
        <span className="ml-2 font-mono text-[11px] text-neutral-500">{viewing ? `v${viewing}` : ""}</span>
        {running && run.mode !== "create" && (
          <span className="flex items-center gap-1 text-[11px] text-indigo-300">
            <Loader2 className="size-3 animate-spin" /> building next version
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-neutral-400">
          <button onClick={reloadPreview} disabled={!src} className="hover:text-white disabled:opacity-40" aria-label="Reload preview">
            <RotateCw className="size-3.5" />
          </button>
          {src && (
            <a href={src} target="_blank" rel="noreferrer" className="hover:text-white" aria-label="Open preview in a new tab">
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {tab === "data" ? (
          <DataPanel projectId={projectId} published={published} />
        ) : src ? (
          <>
            <iframe
              key={`${viewing}-${preview.nonce}`}
              ref={iframeRef}
              src={src}
              title="App preview"
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className="h-full w-full border-0 bg-white"
              data-testid="preview-frame"
              data-status={preview.status}
            />
            {preview.error && (
              <ErrorBanner
                error={preview.error}
                onFix={onFix}
                fixing={fixing}
                autoFix={autoFix}
                onAutoFixChange={setAutoFix}
                attempts={attempts}
              />
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-neutral-500">
            {running ? (
              <>
                <Loader2 className="size-5 animate-spin text-indigo-400" />
                <span>Your app appears here once the first version is built.</span>
              </>
            ) : (
              <span>No version yet.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
