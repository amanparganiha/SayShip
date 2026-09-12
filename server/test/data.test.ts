import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { projects } from "../src/db/schema";
import { registeredAgent, setupTestApp } from "./helpers";

const { app, db, pool } = setupTestApp();
afterAll(() => pool.end());

async function newProject() {
  const { agent } = await registeredAgent(app);
  const res = await agent.post("/api/projects").send({ prompt: "A task board" }).expect(201);
  const [row] = await db.select().from(projects).where(eq(projects.id, res.body.project.id));
  return { agent, project: row! };
}

describe("per-app data API", () => {
  it("supports CRUD with a preview key", async () => {
    const { project } = await newProject();
    const base = `/data/${project.previewKey}/tasks`;

    const empty = await request(app).get(base).expect(200);
    expect(empty.body.items).toEqual([]);

    const created = await request(app).post(base).send({ title: "Write tests", done: false, id: 999 }).expect(201);
    expect(created.body).toMatchObject({ title: "Write tests", done: false });
    expect(created.body.id).not.toBe(999); // server owns ids
    expect(created.body.createdAt).toBeTypeOf("string");

    const updated = await request(app).patch(`${base}/${created.body.id}`).send({ done: true }).expect(200);
    expect(updated.body).toMatchObject({ title: "Write tests", done: true }); // shallow merge

    const list = await request(app).get(base).expect(200);
    expect(list.body.items).toHaveLength(1);

    await request(app).delete(`${base}/${created.body.id}`).expect(204);
    await request(app).delete(`${base}/${created.body.id}`).expect(404);
  });

  it("is CORS-open for sandboxed (opaque-origin) pages and answers preflights", async () => {
    const { project } = await newProject();
    const preflight = await request(app)
      .options(`/data/${project.previewKey}/tasks`)
      .set("Origin", "null")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("*");
    expect(preflight.headers["access-control-allow-methods"]).toContain("PATCH");

    const res = await request(app).get(`/data/${project.previewKey}/tasks`).set("Origin", "null").expect(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });

  it("keeps preview and live data apart; the live key works only while published", async () => {
    const { project } = await newProject();
    await request(app).get(`/data/${project.liveKey}/tasks`).expect(404);

    await db.update(projects).set({ publishedVersion: 1 }).where(eq(projects.id, project.id));
    await request(app).post(`/data/${project.previewKey}/tasks`).send({ title: "preview only" }).expect(201);
    await request(app).post(`/data/${project.liveKey}/tasks`).send({ title: "live only" }).expect(201);

    const preview = await request(app).get(`/data/${project.previewKey}/tasks`).expect(200);
    const live = await request(app).get(`/data/${project.liveKey}/tasks`).expect(200);
    expect(preview.body.items.map((r: { title: string }) => r.title)).toEqual(["preview only"]);
    expect(live.body.items.map((r: { title: string }) => r.title)).toEqual(["live only"]);
  });

  it("isolates apps from each other", async () => {
    const a = await newProject();
    const b = await newProject();
    const rec = await request(app).post(`/data/${a.project.previewKey}/tasks`).send({ title: "a" }).expect(201);
    await request(app).patch(`/data/${b.project.previewKey}/tasks/${rec.body.id}`).send({ title: "hacked" }).expect(404);
    await request(app).delete(`/data/${b.project.previewKey}/tasks/${rec.body.id}`).expect(404);
    await request(app).get(`/data/not-a-real-key/tasks`).expect(404);
  });

  it("validates collection names, bodies and sizes", async () => {
    const { project } = await newProject();
    await request(app).get(`/data/${project.previewKey}/Bad-Name`).expect(400);
    await request(app).post(`/data/${project.previewKey}/tasks`).send([1, 2, 3]).expect(400);
    await request(app)
      .post(`/data/${project.previewKey}/tasks`)
      .send({ blob: "x".repeat(20_000) })
      .expect(413);
  });

  it("shows the owner a data summary and resets preview data", async () => {
    const { agent, project } = await newProject();
    await request(app).post(`/data/${project.previewKey}/tasks`).send({ title: "one" }).expect(201);
    await request(app).post(`/data/${project.previewKey}/notes`).send({ body: "hi" }).expect(201);

    const summary = await agent.get(`/api/projects/${project.id}/data?env=preview`).expect(200);
    expect(summary.body.collections.map((c: { name: string; count: number }) => [c.name, c.count])).toEqual([
      ["notes", 1],
      ["tasks", 1],
    ]);

    await agent.delete(`/api/projects/${project.id}/data`).expect(204);
    const after = await agent.get(`/api/projects/${project.id}/data`).expect(200);
    expect(after.body.collections).toEqual([]);
  });
});
