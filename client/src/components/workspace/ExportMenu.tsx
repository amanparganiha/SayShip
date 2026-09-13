import { ChevronDown, Download, GitBranch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui";

export default function ExportMenu({
  projectId,
  viewing,
  onGitHub,
}: {
  projectId: number;
  viewing: number | null;
  onGitHub: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button size="sm" onClick={() => setOpen((o) => !o)} disabled={viewing === null} data-testid="export-menu">
        Export <ChevronDown className="size-3" />
      </Button>
      {open && viewing !== null && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-56 rounded-md border border-neutral-800 bg-neutral-900 p-1 shadow-xl">
          <a
            role="menuitem"
            href={`/api/projects/${projectId}/versions/${viewing}/export.zip`}
            download
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white"
            data-testid="download-zip"
          >
            <Download className="size-3.5" /> Download ZIP (v{viewing})
          </a>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onGitHub();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white"
          >
            <GitBranch className="size-3.5" /> Push to GitHub
          </button>
        </div>
      )}
    </div>
  );
}
