import { useMutation } from "@tanstack/react-query";
import { Globe, Rocket } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { VersionSummary } from "@shared/api";
import { Header } from "../components/Header";
import { Badge, Button, ErrorText, FullScreenSpinner } from "../components/ui";
import CodeViewer from "../components/workspace/CodeViewer";
import { MAX_AUTO_FIX_ATTEMPTS } from "../components/workspace/ErrorBanner";
import ExportMenu from "../components/workspace/ExportMenu";
import FileTree from "../components/workspace/FileTree";
import GitHubPushDialog from "../components/workspace/GitHubPushDialog";
import PlanView from "../components/workspace/PlanView";
import Preview from "../components/workspace/Preview";
import PublishDialog from "../components/workspace/PublishDialog";
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

  // Auto-fix loop: when the newest version reports an error, hand it to the fixer agent.
  // Capped at MAX_AUTO_FIX_ATTEMPTS in a row; a clean render or a manual change resets the count.
  const previewError = useWorkspace((s) => s.preview.error);
  const autoFix = useWorkspace((s) => s.autoFix);
  const attempts = useWorkspace((s) => s.autoFixAttempts);
  const latestVersion = project.data?.versions.at(-1)?.version ?? null;
  useEffect(() => {
    if (!autoFix || running || !previewError || attempts >= MAX_AUTO_FIX_ATTEMPTS) return;
    if (viewing === null || viewing !== latestVersion) return; // never auto-edit while browsing history
    const timer = setTimeout(() => {
      useWorkspace.getState().countAutoFix();
      fix();
    }, 1200);
    return () => clearTimeout(timer);
  }, [autoFix, running, previewError, attempts, viewing, latestVersion, fix]);

  // Returning from GitHub OAuth (?github=connected|error): reopen the push dialog, clean the URL.
  const [dialog, setDialog] = useState<"publish" | "github" | null>(null);
  const [githubNotice, setGithubNotice] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("github");
    if (!result) return;
    window.history.replaceState(null, "", window.location.pathname);
    void queryClient.invalidateQueries({ queryKey: keys.me });
    setGithubNotice(result === "error" ? (params.get("message") ?? "GitHub sign-in failed.") : null);
    setDialog("github");
  }, []);

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
  const live = info.publishedSlug !== null && info.publishedVersion !== null;

  return (
    <div className="flex h-full flex-col">
      <Header
        actions={
          <>
            <ExportMenu projectId={projectId} viewing={viewing} onGitHub={() => setDialog("github")} />
            <Button
              size="sm"
              variant="primary"
              onClick={() => setDialog("publish")}
              disabled={viewing === null || running}
              data-testid="publish-button"
            >
              <Rocket className="size-3.5" /> Publish
            </Button>
          </>
        }
      >
        <span className="text-neutral-700">/</span>
        <span className="truncate text-sm text-neutral-300" data-testid="project-name">
          {info.name}
        </span>
        {live && (
          <a href={`/p/${info.publishedSlug}`} target="_blank" rel="noreferrer" data-testid="live-badge">
            <Badge tone="green">
              <Globe className="size-3" /> live v{info.publishedVersion}
            </Badge>
          </a>
        )}
      </Header>
      {dialog === "publish" && viewing !== null && (
        <PublishDialog project={info} viewing={viewing} onClose={() => setDialog(null)} />
      )}
      {dialog === "github" && viewing !== null && (
        <GitHubPushDialog project={info} viewing={viewing} notice={githubNotice} onClose={() => setDialog(null)} />
      )}

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
