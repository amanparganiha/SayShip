import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { DataRecord, DataResponse } from "@shared/api";
import { api, errorMessage } from "../../lib/api";
import { useWorkspace } from "../../lib/workspaceStore";
import { Button, ErrorText, Spinner } from "../ui";

const SYSTEM_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** What the generated app has stored in its own database (preview vs. live data). */
export default function DataPanel({ projectId, published }: { projectId: number; published: boolean }) {
  const [env, setEnv] = useState<"preview" | "live">("preview");
  const [picked, setPicked] = useState<string | null>(null);
  const reloadPreview = useWorkspace((s) => s.reloadPreview);

  const data = useQuery({
    queryKey: ["data", projectId, env],
    queryFn: () => api<DataResponse>(`/api/projects/${projectId}/data?env=${env}`),
    refetchInterval: 3000,
  });
  const reset = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/data`, { method: "DELETE" }),
    onSuccess: () => {
      void data.refetch();
      reloadPreview();
    },
  });

  const collections = data.data?.collections ?? [];
  const current = collections.find((c) => c.name === picked) ?? collections[0];
  const columns = current
    ? [...new Set(current.records.flatMap((r) => Object.keys(r)).filter((k) => !SYSTEM_FIELDS.has(k)))].slice(0, 6)
    : [];

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-sm" data-testid="data-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-neutral-800 px-3">
        {(["preview", "live"] as const).map((e) => (
          <button
            key={e}
            onClick={() => setEnv(e)}
            disabled={e === "live" && !published}
            className={clsx(
              "rounded px-2 py-0.5 text-xs",
              env === e ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-neutral-200 disabled:opacity-40",
            )}
          >
            {e === "preview" ? "Preview data" : "Live data"}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => void data.refetch()} className="text-neutral-400 hover:text-white" aria-label="Refresh data">
            <RefreshCw className={clsx("size-3.5", data.isFetching && "animate-spin")} />
          </button>
          {env === "preview" && collections.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => confirm("Delete all preview data for this app?") && reset.mutate()}
              loading={reset.isPending}
            >
              <Trash2 className="size-3" /> Reset
            </Button>
          )}
        </div>
      </div>

      {data.isPending ? (
        <div className="p-4"><Spinner /></div>
      ) : data.isError ? (
        <div className="p-4"><ErrorText>{errorMessage(data.error)}</ErrorText></div>
      ) : collections.length === 0 ? (
        <p className="p-4 text-xs text-neutral-500">
          No {env} data yet. Use the app in the preview. Everything it saves shows up here, stored in Postgres.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ul className="w-40 shrink-0 overflow-y-auto border-r border-neutral-800 py-1">
            {collections.map((c) => (
              <li key={c.name}>
                <button
                  onClick={() => setPicked(c.name)}
                  className={clsx(
                    "flex w-full items-center justify-between px-3 py-1 font-mono text-xs",
                    current?.name === c.name ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-900",
                  )}
                >
                  {c.name} <span className="text-neutral-500">{c.count}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 flex-1 overflow-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="sticky top-0 bg-neutral-900 text-neutral-400">
                <tr>
                  <th className="px-2 py-1 font-medium">id</th>
                  {columns.map((c) => (
                    <th key={c} className="px-2 py-1 font-medium">{c}</th>
                  ))}
                  <th className="px-2 py-1 font-medium">updated</th>
                </tr>
              </thead>
              <tbody>
                {current?.records.map((r: DataRecord) => (
                  <tr key={r.id} className="border-t border-neutral-900 text-neutral-300">
                    <td className="px-2 py-1 text-neutral-500">{r.id}</td>
                    {columns.map((c) => (
                      <td key={c} className="max-w-48 truncate px-2 py-1">{cell(r[c])}</td>
                    ))}
                    <td className="whitespace-nowrap px-2 py-1 text-neutral-500">{new Date(r.updatedAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
