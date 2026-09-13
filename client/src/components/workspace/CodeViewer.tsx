import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../lib/workspaceStore";

const extensions = [javascript({ jsx: true }), EditorView.editable.of(false)];

/** Read-only CodeMirror view of the selected file; follows the file being streamed. */
export default function CodeViewer() {
  const selected = useWorkspace((s) => s.selected);
  const code = useWorkspace((s) => (s.selected ? (s.files[s.selected] ?? "") : ""));
  const status = useWorkspace((s) => (s.selected ? s.status[s.selected] : undefined));
  const follow = useWorkspace((s) => s.follow);
  const setFollow = useWorkspace((s) => s.setFollow);
  const running = useWorkspace((s) => s.run?.status === "running");
  const viewRef = useRef<EditorView | null>(null);
  const [copied, setCopied] = useState(false);

  // While a file streams in, keep its newest lines in view.
  useEffect(() => {
    const view = viewRef.current;
    if (view && follow && status === "streaming") {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length, { y: "end" }) });
    }
  }, [code, follow, status]);

  return (
    <div className="flex h-full flex-col bg-[#282c34]">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-950 px-3">
        <span className="truncate font-mono text-xs text-neutral-300" data-testid="code-path">
          {selected ?? "No file selected"}
          {status === "streaming" && <span className="ml-2 text-indigo-400">writing…</span>}
        </span>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          {running && (
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-indigo-500" />
              Follow
            </label>
          )}
          <button
            onClick={() => {
              void navigator.clipboard.writeText(code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            disabled={!code}
            className="flex items-center gap-1 hover:text-white disabled:opacity-40"
            aria-label="Copy file"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden" data-testid="code-viewer">
        {selected ? (
          <CodeMirror
            value={code}
            height="100%"
            theme={oneDark}
            extensions={extensions}
            readOnly
            basicSetup={{ highlightActiveLine: false, highlightActiveLineGutter: false, foldGutter: true }}
            onCreateEditor={(view) => (viewRef.current = view)}
            className="h-full text-[13px]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            Files appear here as they're written.
          </div>
        )}
      </div>
    </div>
  );
}
