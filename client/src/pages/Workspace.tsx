import { Header } from "../components/Header";
import { ErrorText, FullScreenSpinner } from "../components/ui";
import { errorMessage } from "../lib/api";
import { useProject } from "../lib/queries";

export default function Workspace({ projectId }: { projectId: number }) {
  const project = useProject(projectId);

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

  return (
    <div className="flex h-full flex-col">
      <Header>
        <span className="truncate text-sm text-neutral-400">/ {project.data.project.name}</span>
      </Header>
      <main className="p-6 text-sm text-neutral-400">{project.data.project.prompt}</main>
    </div>
  );
}
