import { QueryClient, useQuery } from "@tanstack/react-query";
import type { MeResponse, ProjectResponse, ProjectSummary, VersionDetail } from "@shared/api";
import { api } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

export const keys = {
  me: ["me"] as const,
  projects: ["projects"] as const,
  project: (id: number) => ["project", id] as const,
  version: (id: number, version: number) => ["project", id, "version", version] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => api<MeResponse>("/api/auth/me") });
}

export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: () => api<{ projects: ProjectSummary[] }>("/api/projects").then((r) => r.projects),
  });
}

export function useProject(id: number) {
  return useQuery({ queryKey: keys.project(id), queryFn: () => api<ProjectResponse>(`/api/projects/${id}`) });
}

export function useVersion(id: number, version: number | null) {
  return useQuery({
    queryKey: keys.version(id, version ?? 0),
    queryFn: () => api<{ version: VersionDetail }>(`/api/projects/${id}/versions/${version}`).then((r) => r.version),
    enabled: version !== null,
    // Versions are immutable.
    staleTime: Infinity,
  });
}
