import { useMutation } from "@tanstack/react-query";
import { Globe, Trash2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import type { ProjectDetail, ProjectSummary } from "@shared/api";
import { Header } from "../components/Header";
import PromptInput from "../components/PromptInput";
import { Badge, ErrorText, Spinner } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { timeAgo } from "../lib/format";
import { keys, queryClient, useProjects } from "../lib/queries";

export default function Dashboard() {
  const projects = useProjects();
  const [, navigate] = useLocation();

  const create = useMutation({
    mutationFn: (prompt: string) =>
      api<{ project: ProjectDetail }>("/api/projects", { method: "POST", json: { prompt } }),
    onSuccess: ({ project }) => {
      void queryClient.invalidateQueries({ queryKey: keys.projects });
      navigate(`/projects/${project.id}`);
    },
  });

  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pb-16 pt-14">
          <h1 className="mb-2 text-center text-3xl font-semibold tracking-tight">What do you want to build?</h1>
          <p className="mb-8 text-center text-sm text-neutral-400">
            PromptShip plans it, writes the code, and runs it live with its own database.
          </p>
          <PromptInput onSubmit={(prompt) => create.mutate(prompt)} loading={create.isPending} />
          <ErrorText>{create.error ? errorMessage(create.error) : null}</ErrorText>

          <section className="mt-14">
            <h2 className="mb-3 text-sm font-medium text-neutral-400">Your projects</h2>
            {projects.isPending ? (
              <Spinner />
            ) : projects.isError ? (
              <ErrorText>{errorMessage(projects.error)}</ErrorText>
            ) : projects.data.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
                No projects yet. Try one of the examples above.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2" data-testid="project-list">
                {projects.data.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const remove = useMutation({
    mutationFn: () => api(`/api/projects/${project.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.projects }),
  });

  return (
    <li className="group relative rounded-lg border border-neutral-800 bg-neutral-900/50 transition-colors hover:border-neutral-600">
      <Link href={`/projects/${project.id}`} className="block p-4">
        <div className="mb-1 flex items-center gap-2">
          <h3 className="truncate font-medium">{project.name}</h3>
          {project.publishedSlug && project.publishedVersion && (
            <Badge tone="green">
              <Globe className="size-3" /> live
            </Badge>
          )}
        </div>
        <p className="line-clamp-2 text-sm text-neutral-400">{project.prompt}</p>
        <p className="mt-3 text-xs text-neutral-500">
          {project.latestVersion ? `v${project.latestVersion}` : "not generated"} · updated {timeAgo(project.updatedAt)}
        </p>
      </Link>
      <button
        onClick={() => {
          if (confirm(`Delete "${project.name}"? This also deletes its data.`)) remove.mutate();
        }}
        className="absolute right-3 top-3 rounded p-1 text-neutral-500 opacity-0 hover:bg-neutral-800 hover:text-red-400 group-hover:opacity-100"
        aria-label={`Delete ${project.name}`}
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}
