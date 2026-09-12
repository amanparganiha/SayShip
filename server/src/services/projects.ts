import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { ProjectDetail, ProjectSummary, VersionDetail, VersionSummary } from "@shared/api";
import type { Db } from "../db/client";
import { generations, projects, type Generation, type Project } from "../db/schema";
import { notFound } from "../lib/http";

/** Every project query is scoped by owner; a project you don't own is indistinguishable from one that doesn't exist. */
export async function getOwnedProject(db: Db, userId: number, projectId: number): Promise<Project> {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (!project) throw notFound("Project");
  return project;
}

const latestVersionSql = sql<number | null>`(select max(${generations.version}) from ${generations} where ${generations.projectId} = ${projects.id})`;

export async function listProjects(db: Db, userId: number): Promise<ProjectSummary[]> {
  const rows = await db
    .select({ project: projects, latestVersion: latestVersionSql })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
  return rows.map((r) => toProjectSummary(r.project, r.latestVersion));
}

const versionSummaryColumns = {
  version: generations.version,
  mode: generations.mode,
  instruction: generations.instruction,
  summary: generations.summary,
  model: generations.model,
  durationMs: generations.durationMs,
  createdAt: generations.createdAt,
};

export async function listVersions(db: Db, projectId: number): Promise<VersionSummary[]> {
  const rows = await db
    .select(versionSummaryColumns)
    .from(generations)
    .where(eq(generations.projectId, projectId))
    .orderBy(asc(generations.version));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function getGeneration(db: Db, projectId: number, version: number): Promise<Generation> {
  const [gen] = await db
    .select()
    .from(generations)
    .where(and(eq(generations.projectId, projectId), eq(generations.version, version)))
    .limit(1);
  if (!gen) throw notFound("Version");
  return gen;
}

export async function getLatestGeneration(db: Db, projectId: number): Promise<Generation | null> {
  const [gen] = await db
    .select()
    .from(generations)
    .where(eq(generations.projectId, projectId))
    .orderBy(desc(generations.version))
    .limit(1);
  return gen ?? null;
}

export function toProjectSummary(project: Project, latestVersion: number | null): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    prompt: project.prompt,
    latestVersion,
    publishedSlug: project.publishedSlug,
    publishedVersion: project.publishedVersion,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function toProjectDetail(project: Project, latestVersion: number | null): ProjectDetail {
  return { ...toProjectSummary(project, latestVersion), plan: project.plan ?? null };
}

export function toVersionDetail(gen: Generation): VersionDetail {
  return {
    version: gen.version,
    mode: gen.mode,
    instruction: gen.instruction,
    summary: gen.summary,
    model: gen.model,
    durationMs: gen.durationMs,
    createdAt: gen.createdAt.toISOString(),
    files: gen.files,
  };
}

/** "Build me a habit tracker with streaks." -> "Habit tracker with streaks" (replaced by the plan's appName later). */
export function nameFromPrompt(prompt: string): string {
  const cleaned = prompt
    .trim()
    .replace(/^(please\s+)?(build|create|make|generate|write|design)\s+(me\s+)?(an?\s+)?(app\s+(for|to|that)\s+)?/i, "")
    .replace(/[.!?\s]+$/, "");
  const base = cleaned || prompt.trim();
  const clipped = base.length <= 48 ? base : base.slice(0, 48).replace(/\s+\S*$/, "");
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}
