import { useMutation } from "@tanstack/react-query";
import { ExternalLink, GitBranch } from "lucide-react";
import { useState } from "react";
import type { ProjectDetail } from "@shared/api";
import { slugify } from "@shared/slug";
import { api, errorMessage } from "../../lib/api";
import { keys, queryClient, useMe } from "../../lib/queries";
import { Button, ErrorText, Input, Label, LinkButton, Modal } from "../ui";

/** Push the generated app (as a runnable Vite project) to a new GitHub repository. */
export default function GitHubPushDialog({
  project,
  viewing,
  notice,
  onClose,
}: {
  project: ProjectDetail;
  viewing: number;
  notice?: string | null;
  onClose: () => void;
}) {
  const me = useMe().data;
  const [repoName, setRepoName] = useState(() => slugify(project.plan?.appName ?? project.name));

  const push = useMutation({
    mutationFn: () =>
      api<{ url: string; fullName: string }>(`/api/projects/${project.id}/export/github`, {
        method: "POST",
        json: { repoName, version: viewing },
      }),
    onError: () => queryClient.invalidateQueries({ queryKey: keys.me }),
  });
  const disconnect = useMutation({
    mutationFn: () => api("/api/github", { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.me }),
  });

  const connectHref = `/api/github/connect?returnTo=${encodeURIComponent(`/projects/${project.id}`)}`;

  return (
    <Modal title="Push to GitHub" onClose={onClose}>
      <div className="space-y-4 text-sm">
        {notice && <ErrorText>{notice}</ErrorText>}

        {!me?.features.github ? (
          <p className="text-neutral-400">
            GitHub export isn't configured on this server (set <code>GITHUB_CLIENT_ID</code> and{" "}
            <code>GITHUB_CLIENT_SECRET</code>). You can still download the project as a ZIP.
          </p>
        ) : !me.user?.githubLogin ? (
          <div className="space-y-3">
            <p className="text-neutral-300">
              Connect your GitHub account to create a public repository with v{viewing} of this app as a runnable Vite
              project.
            </p>
            <LinkButton href={connectHref} variant="primary" className="w-full" data-testid="connect-github">
              <GitBranch className="size-4" /> Connect GitHub
            </LinkButton>
          </div>
        ) : push.data ? (
          <div className="space-y-2 rounded-md border border-emerald-900 bg-emerald-950/30 p-3">
            <p className="text-xs text-emerald-300">Pushed v{viewing} in one commit.</p>
            <a
              href={push.data.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 font-mono text-xs text-neutral-100 hover:underline"
            >
              {push.data.fullName} <ExternalLink className="size-3" />
            </a>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              push.mutate();
            }}
          >
            <p className="text-xs text-neutral-400">
              Connected as <span className="text-neutral-200">@{me.user.githubLogin}</span> ·{" "}
              <button type="button" onClick={() => disconnect.mutate()} className="underline hover:text-neutral-200">
                disconnect
              </button>
            </p>
            <div>
              <Label htmlFor="repo-name">New public repository</Label>
              <Input id="repo-name" value={repoName} onChange={(e) => setRepoName(e.target.value)} />
            </div>
            <ErrorText>{push.error ? errorMessage(push.error) : null}</ErrorText>
            <Button type="submit" variant="primary" className="w-full" loading={push.isPending}>
              <GitBranch className="size-4" /> Create repository and push v{viewing}
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}
