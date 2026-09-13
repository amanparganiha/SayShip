import { useMutation } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Globe } from "lucide-react";
import { useState } from "react";
import type { ProjectDetail } from "@shared/api";
import { api, errorMessage } from "../../lib/api";
import { keys, queryClient } from "../../lib/queries";
import { Button, ErrorText, Modal } from "../ui";

/** One-click publish: the chosen version goes live at a public /p/:slug URL, with its own live data. */
export default function PublishDialog({
  project,
  viewing,
  onClose,
}: {
  project: ProjectDetail;
  viewing: number;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.project(project.id) }),
      queryClient.invalidateQueries({ queryKey: keys.projects }),
    ]);

  const publish = useMutation({
    mutationFn: () =>
      api<{ slug: string; version: number; url: string }>(`/api/projects/${project.id}/publish`, {
        method: "POST",
        json: { version: viewing },
      }),
    onSuccess: refresh,
  });
  const unpublish = useMutation({
    mutationFn: () => api(`/api/projects/${project.id}/publish`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const live = project.publishedSlug !== null && project.publishedVersion !== null;
  const url = project.publishedSlug ? `${window.location.origin}/p/${project.publishedSlug}` : null;
  const error = publish.error ?? unpublish.error;

  return (
    <Modal title="Publish your app" onClose={onClose}>
      <div className="space-y-4 text-sm">
        {live && url ? (
          <div className="space-y-2 rounded-md border border-emerald-900 bg-emerald-950/30 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
              <Globe className="size-3.5" /> Live · serving v{project.publishedVersion}
            </p>
            <div className="flex items-center gap-2">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-100 underline-offset-2 hover:underline"
                data-testid="published-url"
              >
                {url}
              </a>
              <button
                onClick={() =>
                  void navigator.clipboard.writeText(url).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                }
                className="text-neutral-400 hover:text-white"
                aria-label="Copy link"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </button>
              <a href={url} target="_blank" rel="noreferrer" className="text-neutral-400 hover:text-white" aria-label="Open">
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        ) : (
          <p className="text-neutral-300">
            Publish <strong>v{viewing}</strong> to a public URL. Anyone with the link can use the app. Its data is kept
            separate from your preview data.
          </p>
        )}

        <ErrorText>{error ? errorMessage(error) : null}</ErrorText>

        <div className="flex flex-wrap justify-end gap-2">
          {live && (
            <Button variant="ghost" onClick={() => unpublish.mutate()} loading={unpublish.isPending} data-testid="unpublish-button">
              Unpublish
            </Button>
          )}
          {(!live || project.publishedVersion !== viewing) && (
            <Button variant="primary" onClick={() => publish.mutate()} loading={publish.isPending} data-testid="confirm-publish">
              {live ? `Publish v${viewing} instead` : `Publish v${viewing}`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
