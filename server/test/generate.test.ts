import { eq } from "drizzle-orm";
import type { Response } from "superagent";
import type TestAgent from "supertest/lib/agent";
import { afterAll, describe, expect, it } from "vitest";
import type { RunEvent } from "@shared/events";
import { projects, usageEvents } from "../src/db/schema";
import { LlmError, type LlmClient } from "../src/llm/types";
import { registeredAgent, setupTestApp } from "./helpers";

const main = setupTestApp();
const limited = setupTestApp({ env: { DAILY_RUN_LIMIT: "1" } });
const failing = setupTestApp({
  llm: {
    provider: "mock",
    model: "failing",
    structured: async () => {
      throw new LlmError("refused", "The model declined: nope");
    },
    streamText: () => {
      throw new Error("unused");
    },
  } satisfies LlmClient,
});
afterAll(() => Promise.all([main.pool.end(), limited.pool.end(), failing.pool.end()]));

/** superagent doesn't buffer text/event-stream bodies by default. */
const sseText = (res: Response, cb: (err: Error | null, body: string) => void) => {
  let data = "";
  res.setEncoding("utf8");
  res.on("data", (chunk: string) => (data += chunk));
  res.on("end", () => cb(null, data));
};

function parseEvents(text: string): RunEvent[] {
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as RunEvent);
}

async function generate(agent: TestAgent, projectId: number, body: object) {
  const res = await agent
    .post(`/api/projects/${projectId}/generate`)
    .send(body)
    .buffer(true)
    .parse(sseText as never);
  return { res, events: res.status === 200 ? parseEvents(res.body as string) : [] };
}

async function newProject(app = main.app) {
  const owner = await registeredAgent(app);
  const res = await owner.agent.post("/api/projects").send({ prompt: "A task board for my team" }).expect(201);
  return { agent: owner.agent, id: res.body.project.id as number };
}

describe("POST /api/projects/:id/generate", () => {
  it("streams a create run and saves version 1 with the plan", async () => {
    const { agent, id } = await newProject();
    const { res, events } = await generate(agent, id, { mode: "create" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(events[0]).toMatchObject({ type: "run", mode: "create", projectId: id, baseVersion: null });
    expect(events.map((e) => e.type)).toContain("plan");
    expect(events.filter((e) => e.type === "file_delta").length).toBeGreaterThan(10);
    const done = events.at(-1)!;
    expect(done).toMatchObject({ type: "done", version: { version: 1, mode: "create" }, project: { name: "Task board" } });

    const detail = await agent.get(`/api/projects/${id}`).expect(200);
    expect(detail.body.project.plan.appName).toBe("Task board");
    expect(detail.body.versions.map((v: { version: number }) => v.version)).toEqual([1]);

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.usage.used).toBe(1);

    // A project is created once; afterwards you iterate.
    const again = await agent.post(`/api/projects/${id}/generate`).send({ mode: "create" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("already_generated");
  });

  it("iterates, fixes and restores as new immutable versions", async () => {
    const { agent, id } = await newProject();
    await generate(agent, id, { mode: "create" });

    const iterate = await generate(agent, id, { mode: "iterate", instruction: "show a footer" });
    expect(iterate.events.at(-1)).toMatchObject({ type: "done", version: { version: 2, mode: "iterate", instruction: "show a footer" } });
    const v2 = await agent.get(`/api/projects/${id}/versions/2`).expect(200);
    const app2 = v2.body.version.files.find((f: { path: string }) => f.path === "App.jsx").content;
    expect(app2).toContain("Updated: show a footer");

    const fix = await generate(agent, id, {
      mode: "fix",
      error: { kind: "runtime-error", message: "ReferenceError: x is not defined" },
    });
    expect(fix.events.at(-1)).toMatchObject({ type: "done", version: { version: 3, mode: "fix" } });

    const restored = await agent.post(`/api/projects/${id}/versions/1/restore`).expect(201);
    expect(restored.body.version).toMatchObject({ version: 4, mode: "restore", summary: "Restored v1" });
    const v1 = await agent.get(`/api/projects/${id}/versions/1`).expect(200);
    const v4 = await agent.get(`/api/projects/${id}/versions/4`).expect(200);
    expect(v4.body.version.files).toEqual(v1.body.version.files);
  });

  it("rejects bad requests before streaming", async () => {
    const { agent, id } = await newProject();
    const editFirst = await agent.post(`/api/projects/${id}/generate`).send({ mode: "iterate", instruction: "do things" });
    expect(editFirst.status).toBe(409);
    expect(editFirst.body.error).toBe("nothing_to_edit");

    await agent.post(`/api/projects/${id}/generate`).send({ mode: "iterate", instruction: "x" }).expect(400);
    await agent.post(`/api/projects/${id}/generate`).send({ mode: "delete-everything" }).expect(400);

    const stranger = await registeredAgent(main.app);
    await stranger.agent.post(`/api/projects/${id}/generate`).send({ mode: "create" }).expect(404);
  });

  it("allows one run per project at a time (DB lease)", async () => {
    const { agent, id } = await newProject();
    await main.db
      .update(projects)
      .set({ runLeaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(projects.id, id));
    const res = await agent.post(`/api/projects/${id}/generate`).send({ mode: "create" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("run_in_progress");

    // An expired lease (crashed instance) doesn't block.
    await main.db.update(projects).set({ runLeaseUntil: new Date(Date.now() - 1000) }).where(eq(projects.id, id));
    const { events } = await generate(agent, id, { mode: "create" });
    expect(events.at(-1)!.type).toBe("done");
  });

  it("enforces the daily run quota", async () => {
    const { agent, id } = await newProject(limited.app);
    await generate(agent, id, { mode: "create" });
    const res = await agent.post(`/api/projects/${id}/generate`).send({ mode: "iterate", instruction: "add dark mode" });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("quota_exceeded");
  });

  it("stops everyone once the global daily budget is spent", async () => {
    const [{ n }] = (await main.pool.query("select count(*)::int as n from usage_events")).rows as [{ n: number }];
    const capped = setupTestApp({ env: { GLOBAL_DAILY_RUN_LIMIT: String(n) } });
    try {
      const { agent, id } = await newProject(capped.app);
      const res = await agent.post(`/api/projects/${id}/generate`).send({ mode: "create" });
      expect(res.status).toBe(429);
      expect(res.body.message).toMatch(/daily generation budget/);
    } finally {
      await capped.pool.end();
    }
  });

  it("reports model failures as an error event, releases the lease and still counts usage", async () => {
    const { agent, id } = await newProject(failing.app);
    const { events } = await generate(agent, id, { mode: "create" });
    expect(events.at(-1)).toEqual({ type: "error", code: "llm_refused", message: "The model declined: nope" });

    const [project] = await failing.db.select().from(projects).where(eq(projects.id, id));
    expect(project!.runLeaseUntil).toBeNull();
    const usage = await failing.db.select().from(usageEvents).where(eq(usageEvents.projectId, id));
    expect(usage.map((u) => u.ok)).toEqual([false]);
  });
});
