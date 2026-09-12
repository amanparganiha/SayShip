import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { nameFromPrompt } from "../src/services/projects";
import { registeredAgent, setupTestApp } from "./helpers";

const { app, pool } = setupTestApp();
afterAll(() => pool.end());

describe("nameFromPrompt", () => {
  it("turns a prompt into a short project name", () => {
    expect(nameFromPrompt("Build me a habit tracker with streaks.")).toBe("Habit tracker with streaks");
    expect(nameFromPrompt("create an app for splitting expenses with roommates")).toBe(
      "Splitting expenses with roommates",
    );
    expect(nameFromPrompt("kanban board")).toBe("Kanban board");
    expect(nameFromPrompt("a".repeat(10) + " " + "b".repeat(60)).length).toBeLessThanOrEqual(48);
  });
});

describe("projects API", () => {
  it("requires a session", async () => {
    await request(app).get("/api/projects").expect(401);
    await request(app).post("/api/projects").send({ prompt: "todo app" }).expect(401);
  });

  it("creates, lists, reads and deletes the caller's projects", async () => {
    const { agent } = await registeredAgent(app);

    const created = await agent.post("/api/projects").send({ prompt: "Build a kanban board" }).expect(201);
    const project = created.body.project;
    expect(project).toMatchObject({ name: "Kanban board", prompt: "Build a kanban board", latestVersion: null });
    expect(project).not.toHaveProperty("previewKey");

    const list = await agent.get("/api/projects").expect(200);
    expect(list.body.projects.map((p: { id: number }) => p.id)).toContain(project.id);

    const detail = await agent.get(`/api/projects/${project.id}`).expect(200);
    expect(detail.body.project.plan).toBeNull();
    expect(detail.body.versions).toEqual([]);

    await agent.get(`/api/projects/${project.id}/versions/1`).expect(404);
    await agent.delete(`/api/projects/${project.id}`).expect(204);
    await agent.get(`/api/projects/${project.id}`).expect(404);
  });

  it("hides other users' projects (404, not 403)", async () => {
    const alice = await registeredAgent(app);
    const bob = await registeredAgent(app);
    const created = await alice.agent.post("/api/projects").send({ prompt: "Alice's secret app" }).expect(201);
    const id = created.body.project.id;

    await bob.agent.get(`/api/projects/${id}`).expect(404);
    await bob.agent.get(`/api/projects/${id}/versions/1`).expect(404);
    await bob.agent.delete(`/api/projects/${id}`).expect(404);
    const bobList = await bob.agent.get("/api/projects").expect(200);
    expect(bobList.body.projects).toEqual([]);

    await alice.agent.get(`/api/projects/${id}`).expect(200);
  });

  it("validates input", async () => {
    const { agent } = await registeredAgent(app);
    await agent.post("/api/projects").send({ prompt: "  " }).expect(400);
    await agent.post("/api/projects").send({ prompt: "x".repeat(2001) }).expect(400);
    await agent.get("/api/projects/abc").expect(404);
    await agent.get("/api/projects/-1").expect(404);
  });
});
