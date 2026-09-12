import { ENTRY_FILE, MAX_FILES, normalizeAppPath, PlanSchema, type Plan } from "@shared/schemas";
import { COLLECTION_RE } from "../services/appData";
import type { LlmClient, UsageMeter } from "../llm/types";
import { PLANNER_SYSTEM } from "./prompts";

export async function planApp(
  llm: LlmClient,
  prompt: string,
  opts: { signal?: AbortSignal; meter?: UsageMeter },
): Promise<Plan> {
  const plan = await llm.structured({
    schema: PlanSchema,
    name: "app_plan",
    system: PLANNER_SYSTEM,
    user: `App idea:\n${prompt}`,
    trace: { step: "plan", prompt },
    ...opts,
  });
  return normalizePlan(plan);
}

const toCollectionName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 40);

/**
 * The schema can't express our limits, so enforce them here: valid unique paths, at most
 * MAX_FILES, App.jsx present and last (the entry is written after everything it imports).
 */
export function normalizePlan(plan: Plan): Plan {
  const seen = new Set<string>();
  const files: Plan["files"] = [];
  let entryPurpose = "Root component: page layout, state wiring and composition of the other files";

  for (const file of plan.files) {
    const path = normalizeAppPath(file.path);
    if (!path || seen.has(path)) continue;
    if (path === ENTRY_FILE) {
      entryPurpose = file.purpose.trim() || entryPurpose;
      continue;
    }
    seen.add(path);
    files.push({ path, purpose: file.purpose.trim() || "Part of the app" });
  }
  files.splice(MAX_FILES - 1);
  files.push({ path: ENTRY_FILE, purpose: entryPurpose });

  const entities = plan.entities
    .map((e) => ({ ...e, name: toCollectionName(e.name), fields: e.fields.slice(0, 12) }))
    .filter((e, i, all) => COLLECTION_RE.test(e.name) && all.findIndex((o) => o.name === e.name) === i)
    .slice(0, 6);

  return {
    appName: plan.appName.trim().slice(0, 60) || "My app",
    description: plan.description.trim().slice(0, 500),
    entities,
    features: plan.features.map((f) => f.trim()).filter(Boolean).slice(0, 8),
    files,
  };
}
