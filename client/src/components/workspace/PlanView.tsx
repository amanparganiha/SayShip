import { Database, ListChecks } from "lucide-react";
import type { Plan } from "@shared/schemas";

/** The planner's output: what will be built, its collections (schema) and features. */
export default function PlanView({ plan }: { plan: Plan }) {
  return (
    <section className="space-y-3 text-sm" data-testid="plan-view">
      <div>
        <h2 className="font-semibold text-neutral-100">{plan.appName}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-neutral-400">{plan.description}</p>
      </div>

      {plan.entities.length > 0 && (
        <div>
          <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            <Database className="size-3" /> Data
          </h3>
          <ul className="space-y-1">
            {plan.entities.map((entity) => (
              <li key={entity.name} className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5">
                <span className="font-mono text-xs text-indigo-300">{entity.name}</span>
                <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-neutral-500">
                  {entity.fields.map((f) => `${f.name}: ${f.type}`).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.features.length > 0 && (
        <div>
          <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            <ListChecks className="size-3" /> Features
          </h3>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-neutral-300">
            {plan.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
