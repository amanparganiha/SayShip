import { describe, expect, it } from "vitest";
import type { RunEvent } from "@shared/events";
import { normalizeEditPlan } from "../src/agent/editor";
import { runCreate, runEdit, type RunContext } from "../src/agent/pipeline";
import { normalizePlan } from "../src/agent/planner";
import { FenceFilter, stripFences } from "../src/agent/writer";
import { createMockClient } from "../src/llm/mock";
import { MOCK_FILES, MOCK_PLAN, taskBoardApp } from "../src/llm/mockApp";
import { UsageMeter } from "../src/llm/types";

function makeContext(signal: AbortSignal = new AbortController().signal, delayMs = 0) {
  const events: RunEvent[] = [];
  const ctx: RunContext = {
    llm: createMockClient({ delayMs }),
    emit: (e) => events.push(e),
    signal,
    meter: new UsageMeter(),
  };
  return { ctx, events };
}

/** Event sequence without the (many) deltas, e.g. "file_start:App.jsx". */
const outline = (events: RunEvent[]) =>
  events
    .filter((e) => e.type !== "file_delta")
    .map((e) =>
      e.type === "status" ? `status:${e.phase}` : e.type === "file_start" || e.type === "file_done" ? `${e.type}:${e.path}` : e.type,
    );

const fileContent = (files: { path: string; content: string }[], path: string) => files.find((f) => f.path === path)?.content;

describe("runCreate", () => {
  it("plans, streams each file in dependency order, then checks the build", async () => {
    const { ctx, events } = makeContext();
    const result = await runCreate(ctx, { prompt: "a task board" });

    expect(outline(events)).toEqual([
      "status:planning",
      "plan",
      "status:writing",
      "file_start:components/TaskItem.jsx",
      "file_done:components/TaskItem.jsx",
      "status:writing",
      "file_start:App.jsx",
      "file_done:App.jsx",
      "status:checking",
      "check",
    ]);
    expect(result.files).toEqual(MOCK_FILES);
    expect(result.plan.appName).toBe("Task board");

    // The streamed deltas reassemble into exactly the saved file.
    const streamed = events
      .filter((e): e is Extract<RunEvent, { type: "file_delta" }> => e.type === "file_delta" && e.path === "App.jsx")
      .map((e) => e.delta)
      .join("");
    expect(streamed).toBe(fileContent(MOCK_FILES, "App.jsx"));
  });

  it("repairs a build error once, using the compiler's error", async () => {
    const { ctx, events } = makeContext();
    const result = await runCreate(ctx, { prompt: "a task board [syntax]" });

    const checks = events.filter((e): e is Extract<RunEvent, { type: "check" }> => e.type === "check");
    expect(checks.map((c) => c.ok)).toEqual([false, true]);
    expect(checks[0]!.errors[0]).toMatchObject({ file: "App.jsx" });
    expect(outline(events)).toContain("status:repairing");
    expect(fileContent(result.files, "App.jsx")).toBe(taskBoardApp());
  });

  it("stops promptly when the client disconnects", async () => {
    const controller = new AbortController();
    const { ctx } = makeContext(controller.signal, 5);
    const run = runCreate(ctx, { prompt: "a task board" });
    setTimeout(() => controller.abort(new Error("client disconnected")), 20);
    await expect(run).rejects.toThrow("client disconnected");
  });
});

describe("runEdit", () => {
  it("rewrites only the files the editor chose (iterate)", async () => {
    const { ctx, events } = makeContext();
    const result = await runEdit(ctx, {
      plan: MOCK_PLAN,
      files: MOCK_FILES,
      request: { kind: "instruction", text: "add a footer" },
      prompt: "a task board",
    });
    expect(result.summary).toBe("Applied: add a footer");
    expect(events.filter((e) => e.type === "file_start").map((e) => (e as { path: string }).path)).toEqual(["App.jsx"]);
    expect(fileContent(result.files, "App.jsx")).toContain("Updated: add a footer");
    expect(fileContent(result.files, "components/TaskItem.jsx")).toBe(fileContent(MOCK_FILES, "components/TaskItem.jsx"));
  });

  it("fixes a runtime error reported by the preview", async () => {
    const broken = [MOCK_FILES[0]!, { path: "App.jsx", content: taskBoardApp({ broken: true }) }];
    const { ctx } = makeContext();
    const result = await runEdit(ctx, {
      plan: MOCK_PLAN,
      files: broken,
      request: { kind: "runtime-error", message: "ReferenceError: formatSummary is not defined" },
      prompt: "a task board",
    });
    expect(result.summary).toMatch(/runtime error/);
    expect(fileContent(result.files, "App.jsx")).not.toContain("formatSummary");
  });
});

describe("plan normalization", () => {
  it("keeps valid unique paths and puts App.jsx last", () => {
    const plan = normalizePlan({
      ...MOCK_PLAN,
      files: [
        { path: "App.jsx", purpose: "root component" },
        { path: "./components/Card.jsx", purpose: "a card" },
        { path: "../escape.js", purpose: "nope" },
        { path: "styles.css", purpose: "nope" },
        { path: "components/Card.jsx", purpose: "duplicate" },
        { path: "lib/format.js", purpose: "helpers" },
      ],
      entities: [
        { name: "Expense Items", fields: [] },
        { name: "123", fields: [] },
      ],
    });
    expect(plan.files.map((f) => f.path)).toEqual(["components/Card.jsx", "lib/format.js", "App.jsx"]);
    expect(plan.files.at(-1)!.purpose).toBe("root component");
    expect(plan.entities.map((e) => e.name)).toEqual(["expense_items"]);
  });

  it("adds App.jsx when the model forgot it and caps the file count", () => {
    const plan = normalizePlan({
      ...MOCK_PLAN,
      files: Array.from({ length: 12 }, (_, i) => ({ path: `components/C${i}.jsx`, purpose: "x" })),
    });
    expect(plan.files).toHaveLength(8);
    expect(plan.files.at(-1)!.path).toBe("App.jsx");
  });

  it("makes edit plans applicable", () => {
    const edit = normalizeEditPlan(
      {
        summary: "  ",
        changes: [
          { path: "App.jsx", action: "delete", instructions: "" },
          { path: "components/New.jsx", action: "modify", instructions: "new card" },
          { path: "App.jsx", action: "create", instructions: "use the card" },
          { path: "../x.js", action: "create", instructions: "" },
        ],
      },
      MOCK_FILES,
    );
    expect(edit.summary).toBe("Updated the app");
    expect(edit.changes.map((c) => `${c.action}:${c.path}`)).toEqual(["create:components/New.jsx", "modify:App.jsx"]);
  });
});

describe("code fences", () => {
  it("strips a fence around the whole file", () => {
    expect(stripFences("```jsx\nconst a = 1;\n```")).toBe("const a = 1;\n");
    expect(stripFences("```\nconst a = 1;\n```\n")).toBe("const a = 1;\n");
    expect(stripFences("const a = 1;")).toBe("const a = 1;\n");
  });

  it("filters a fence out of streamed output", () => {
    const fenced = new FenceFilter();
    expect(["``", "`jsx\nconst", " a = 1;\n", "```"].map((d) => fenced.push(d)).join("")).toBe("const a = 1;\n```");
    const plain = new FenceFilter();
    expect(["imp", "ort x"].map((d) => plain.push(d)).join("")).toBe("import x");
  });
});
