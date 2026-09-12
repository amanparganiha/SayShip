import type { GeneratedFile, GenerationMode, Plan } from "./schemas";

/** Response shapes shared by the API routes and the client. Dates are ISO strings on the wire. */

export type UserDTO = {
  id: number;
  username: string;
  isGuest: boolean;
  githubLogin: string | null;
};

export type UsageDTO = { used: number; limit: number; remaining: number };

export type MeResponse = {
  user: UserDTO | null;
  usage: UsageDTO | null;
  features: { llm: "openai" | "mock"; github: boolean };
};

export type ProjectSummary = {
  id: number;
  name: string;
  prompt: string;
  latestVersion: number | null;
  publishedSlug: string | null;
  publishedVersion: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetail = ProjectSummary & {
  plan: Plan | null;
};

export type VersionSummary = {
  version: number;
  mode: GenerationMode;
  instruction: string | null;
  summary: string | null;
  model: string | null;
  durationMs: number;
  createdAt: string;
};

export type VersionDetail = VersionSummary & { files: GeneratedFile[] };

export type ProjectResponse = { project: ProjectDetail; versions: VersionSummary[] };

export type ApiErrorBody = { error: string; message: string; details?: unknown };
