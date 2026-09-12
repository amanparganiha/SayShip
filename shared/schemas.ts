import { z } from "zod";

/**
 * Schemas shared by the server (LLM structured outputs, validation) and the client (types).
 *
 * The LLM-facing schemas intentionally carry no min/max constraints: OpenAI strict structured
 * outputs support only a subset of JSON Schema, so limits are enforced by our own validation
 * (see `normalizePlan` on the server) after parsing.
 */

export const EntitySchema = z.object({
  /** Collection name used with useCollection(), snake_case plural, e.g. "habits". */
  name: z.string(),
  fields: z.array(z.object({ name: z.string(), type: z.string() })),
});

export const PlannedFileSchema = z.object({
  path: z.string(),
  purpose: z.string(),
});

export const PlanSchema = z.object({
  appName: z.string(),
  description: z.string(),
  entities: z.array(EntitySchema),
  features: z.array(z.string()),
  /** Files in dependency order; the entry file App.jsx comes last. */
  files: z.array(PlannedFileSchema),
});
export type Plan = z.infer<typeof PlanSchema>;
export type PlannedFile = z.infer<typeof PlannedFileSchema>;

export const EditActionSchema = z.enum(["create", "modify", "delete"]);
export type EditAction = z.infer<typeof EditActionSchema>;

export const EditPlanSchema = z.object({
  summary: z.string(),
  changes: z.array(
    z.object({
      path: z.string(),
      action: EditActionSchema,
      instructions: z.string(),
    }),
  ),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

export const GeneratedFileSchema = z.object({
  path: z.string(),
  content: z.string(),
});
export type GeneratedFile = z.infer<typeof GeneratedFileSchema>;

export const GENERATION_MODES = ["create", "iterate", "fix", "restore"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const ENTRY_FILE = "App.jsx";
export const MAX_FILES = 8;

const APP_PATH_RE = /^(?:[A-Za-z0-9_-]+\/){0,2}[A-Za-z0-9_-]+\.(?:jsx|js)$/;

/**
 * Normalizes a generated-app file path ("./components/Card.jsx" -> "components/Card.jsx").
 * Returns null for anything outside the allowed shape (no "..", no absolute paths, .js/.jsx only).
 */
export function normalizeAppPath(raw: string): string | null {
  const path = raw.trim().replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
  if (path.length === 0 || path.length > 100) return null;
  if (!APP_PATH_RE.test(path)) return null;
  return path;
}
