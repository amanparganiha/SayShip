import type { EditPlan } from "@shared/schemas";
import { MOCK_PLAN, TASK_ITEM, taskBoardApp } from "./mockApp";
import type { LlmClient } from "./types";

/**
 * Deterministic stand-in for the model: lets the whole product (and its tests) run without an
 * API key. Magic words in the prompt trigger the failure paths:
 *   "[broken]" -> App.jsx throws at runtime (exercises the preview -> auto-fix loop)
 *   "[syntax]" -> App.jsx doesn't compile (exercises the pipeline's self-repair)
 */
export function createMockClient(options: { delayMs?: number } = {}): LlmClient {
  const delayMs = options.delayMs ?? 12;

  const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      // setTimeout(0) still costs a timer tick (~15ms on Windows); tests run with no delay at all.
      if (ms <= 0) return resolve();
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    });

  return {
    provider: "mock",
    model: "mock",

    async structured({ trace, signal }) {
      await wait(delayMs * 20, signal);
      if (trace.step === "plan") return structuredClone(MOCK_PLAN) as never;
      if (trace.step === "edit-plan") {
        const plan: EditPlan =
          trace.kind === "instruction"
            ? {
                summary: `Applied: ${trace.instruction ?? "change"}`,
                changes: [{ path: "App.jsx", action: "modify", instructions: trace.instruction ?? "" }],
              }
            : {
                summary: trace.kind === "build-errors" ? "Fixed a syntax error in App.jsx" : "Fixed a runtime error in App.jsx",
                changes: [{ path: "App.jsx", action: "modify", instructions: "Fix the reported error." }],
              };
        return plan as never;
      }
      throw new Error(`mock: unexpected structured call for step ${trace.step}`);
    },

    async *streamText({ trace, signal }) {
      if (trace.step !== "write") throw new Error(`mock: unexpected text call for step ${trace.step}`);
      let content: string;
      if (trace.path === "components/TaskItem.jsx") content = TASK_ITEM;
      else if (trace.path !== "App.jsx") content = `export default function Placeholder() {\n  return null;\n}\n`;
      else if (trace.action === "create" && trace.prompt.includes("[syntax]")) content = "export default function App() {\n  return (\n    <main>\n  );\n}\n";
      else if (trace.action === "create" && trace.prompt.includes("[broken]")) content = taskBoardApp({ broken: true });
      else if (trace.instruction && !trace.fix) content = taskBoardApp({ footer: `Updated: ${escapeJsxText(trace.instruction)}` });
      else content = taskBoardApp();

      // Stream in small chunks, like a real model.
      for (let i = 0; i < content.length; i += 40) {
        await wait(delayMs, signal);
        yield content.slice(i, i + 40);
      }
    },
  };
}

const escapeJsxText = (s: string) => s.replace(/[{}<>]/g, "");
