import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { VersionSummary } from "@shared/api";
import { Header } from "../components/Header";
import { ErrorText, FullScreenSpinner } from "../components/ui";
import CodeViewer from "../components/workspace/CodeViewer";
import FileTree from "../components/workspace/FileTree";
import PlanView from "../components/workspace/PlanView";
import Preview from "../components/workspace/Preview";
import RefineInput from "../components/workspace/RefineInput";
import RunTimeline from "../components/workspace/RunTimeline";
import VersionHistory from "../components/workspace/VersionHistory";
import { useRunner } from "../hooks/useRunner";
import { api, errorMessage } from "../lib/api";
import { keys, queryClient, useProject, useVersion } from "../lib/queries";
import { useWorkspace } from "../lib/workspaceStore";

function ResizeHandle({ direction = "vertical" }: { direction?: "vertical" | "horizontal" }) {
  return (
    <Separator
      className={
        direction === "vertical"
          ? "w-px bg-neutral-800 transition-colors hover:bg-indigo-500 data-[separator=active]:bg-indigo-500"
          : "h-px bg-neutral-800 transition-colors hover:bg-indigo-500 data-[separator=active]:bg-indigo-500"
      }
    />
  );
}

export default function Workspace({ projectId }: { projectId: number }) {
  const project = useProject(projectId);
  const viewing = useWorkspace((s) => s.viewing);
  const loaded = useWorkspace((s) => s.loaded);
  const plan = useWorkspace((s) => s.plan);
  const running = useWorkspace((s) => s.run?.status === "running");
  const version = useVersion(projectId, viewing);
  const { start, retry } = useRunner(projectId);

  // First load: reset the store for this project, show the latest version, and generate the
  // first version right away for a brand-new project. (The ref survives StrictMode's re-run.)
  const initialized = useRef(false);
  useEffect(() => {
    const data = project.data;
    if (!data || initialized.current) return;
    initialized.current = true;
    const store = useWorkspace.getState();
    store.reset(projectId, data.project.plan);
    const latest = data.versions.at(-1)?.version;
    if (latest) store.view(latest);
    else void start({ mode: "create" });
  }, [project.data, projectId, start]);

  // Load the files of the version being viewed (runs already stream theirs in).
  useEffect(() => {
    const v = version.data;
    if (v && v.version === viewing && loaded !== v.version && !running) useWorkspace.getState().showVersion(v);
  }, [version.data, viewing, loaded, running]);

  const iterate = useCallback(
    (instruction: string) => {
      const s = useWorkspace.getState();
      useWorkspace.setState({ autoFixAttempts: 0 });
      void start({ mode: "iterate", instruction, baseVersion: s.viewing ?? undefined });
    },
    [start],
  );

  const fix = useCallback(() => {
    const s = useWorkspace.getState();
    if (!s.preview.error || s.run?.status === "running") return;
    void start({ mode: "fix", error: s.preview.error, baseVersion: s.viewing ?? undefined });
  }, [start]);

  const restore = useMutation({
    mutationFn: (v: number) =>
      api<{ version: VersionSummary }>(`/api/projects/${projectId}/versions/${v}/restore`, { method: "POST" }),
    onSuccess: async ({ version: restored }) => {
      await queryClient.invalidateQueries({ queryKey: keys.project(projectId) });
      useWorkspace.getState().view(restored.version);
    },
  });

  if (project.isPending) return <FullScreenSpinner />;
  if (project.isError) {
    return (
      <div className="flex h-full flex-col">
        <Header />
        <div className="p-6">
          <ErrorText>{errorMessage(project.error)}</ErrorText>
        </div>
      </div>
    );
  }

  const { project: info, versions } = project.data;
  const latest = versions.at(-1)?.version ?? null;

  return (
    <div className="flex h-full flex-col">
      <Header>
        <span className="text-neutral-700">/</span>
        <span className="truncate text-sm text-neutral-300" data-testid="project-name">
          {info.name}
        </span>
      </Header>

      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize="24" minSize="16" maxSize="40" className="flex flex-col bg-neutral-950">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            <p className="line-clamp-3 text-xs italic text-neutral-500" title={info.prompt}>
              “{info.prompt}”
            </p>
            <RunTimeline onRetry={retry} />
            {plan && <PlanView plan={plan} />}
            <VersionHistory versions={versions} onRestore={(v) => restore.mutate(v)} restoring={restore.isPending} />
            {restore.error && <ErrorText>{errorMessage(restore.error)}</ErrorText>}
          </div>
          <div className="border-t border-neutral-800 p-3">
            <RefineInput
              onSubmit={iterate}
              disabled={running || latest === null}
              baseNote={viewing !== null && viewing !== latest ? `Changes start from v${viewing}` : undefined}
            />
          </div>
        </Panel>
        <ResizeHandle />
        <Panel defaultSize="14" minSize="9" maxSize="30" className="bg-neutral-950">
          <FileTree />
        </Panel>
        <ResizeHandle />
        <Panel defaultSize="62" minSize="30">
          <Group orientation="vertical" className="h-full">
            <Panel defaultSize="42" minSize="12">
              <CodeViewer />
            </Panel>
            <ResizeHandle direction="horizontal" />
            <Panel defaultSize="58" minSize="20">
              <Preview projectId={projectId} published={info.publishedVersion !== null} onFix={fix} />
            </Panel>
          </Group>
        </Panel>
      </Group>
    </div>
  );
}
