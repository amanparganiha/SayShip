import clsx from "clsx";
import { History } from "lucide-react";
import type { VersionSummary } from "@shared/api";
import type { GenerationMode } from "@shared/schemas";
import { timeAgo } from "../../lib/format";
import { useWorkspace } from "../../lib/workspaceStore";
import { Badge, Button } from "../ui";

const MODE: Record<GenerationMode, { label: string; tone: "indigo" | "neutral" | "green" | "amber" }> = {
  create: { label: "created", tone: "indigo" },
  iterate: { label: "changed", tone: "neutral" },
  fix: { label: "fixed", tone: "green" },
  restore: { label: "restored", tone: "amber" },
};

/** Every generation is an immutable version: view any of them, or restore one as a new version. */
export default function VersionHistory({
  versions,
  onRestore,
  restoring,
}: {
  versions: VersionSummary[];
  onRestore: (version: number) => void;
  restoring: boolean;
}) {
  const viewing = useWorkspace((s) => s.viewing);
  const view = useWorkspace((s) => s.view);
  const running = useWorkspace((s) => s.run?.status === "running");
  const latest = versions.at(-1)?.version;

  if (versions.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        <History className="size-3" /> Versions
      </h3>
      <ul className="space-y-0.5" data-testid="version-history">
        {[...versions].reverse().map((v) => {
          const active = v.version === viewing;
          return (
            <li key={v.version}>
              <button
                onClick={() => view(v.version)}
                disabled={running}
                data-testid={`version-${v.version}`}
                aria-current={active}
                className={clsx(
                  "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs",
                  active ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-900",
                )}
              >
                <span className="font-mono text-neutral-500">v{v.version}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <Badge tone={MODE[v.mode].tone}>{MODE[v.mode].label}</Badge>
                    <span className="text-[11px] text-neutral-600">{timeAgo(v.createdAt)}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block">{v.summary ?? v.instruction}</span>
                </span>
              </button>
              {active && v.version !== latest && (
                <div className="px-2 pb-1">
                  <Button size="sm" onClick={() => onRestore(v.version)} loading={restoring} disabled={running}>
                    Restore v{v.version} as latest
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
