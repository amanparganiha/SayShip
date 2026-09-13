import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { generations, projects } from "../src/db/schema";
import { MOCK_FILES } from "../src/llm/mockApp";
import { registeredAgent, setupTestApp } from "./helpers";

const { app, db, pool } = setupTestApp();
afterAll(() => pool.end());

async function projectWithVersion(files = MOCK_FILES) {
  const owner = await registeredAgent(app);
  const res = await owner.agent.post("/api/projects").send({ prompt: "A task board" }).expect(201);
  const id: number = res.body.project.id;
  await db.insert(generations).values({ projectId: id, version: 1, mode: "create", files });
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  return { owner, project: project! };
}

describe("preview pages", () => {
  it("serves the owner a sandboxed page with the preview data key", async () => {
    const { owner, project } = await projectWithVersion();
    const res = await owner.agent.get(`/preview/${project.id}/1`).expect(200);

    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("sandbox allow-scripts allow-forms allow-modals allow-popups");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp).toMatch(/connect-src http:\/\/127\.0\.0\.1:\d+/);
    expect(res.headers["cache-control"]).toBe("no-store");

    expect(res.text).toContain(project.previewKey);
    expect(res.text).not.toContain(project.liveKey);
    expect(res.text).toMatch(/<script src="\/runtime\/react-dev\.[0-9a-f]{10}\.js" crossorigin="anonymous">/);
    expect(res.text).toContain("Task board");
  });

  it("is private: 401 when signed out, 404 for other users and unknown versions", async () => {
    const { project } = await projectWithVersion();
    await request(app).get(`/preview/${project.id}/1`).expect(401);
    const stranger = await registeredAgent(app);
    await stranger.agent.get(`/preview/${project.id}/1`).expect(404);
    const { owner, project: other } = await projectWithVersion();
    await owner.agent.get(`/preview/${other.id}/2`).expect(404);
    await owner.agent.get(`/preview/abc/1`).expect(404);
  });

  it("renders build errors instead of the app", async () => {
    const { owner, project } = await projectWithVersion([{ path: "App.jsx", content: "export default function App( {" }]);
    const res = await owner.agent.get(`/preview/${project.id}/1`).expect(200);
    expect(res.text).toContain("window.__sayship.buildFailed(");
  });
});

describe("published apps", () => {
  it("serves /p/:slug publicly with the live key, and 404s once unpublished", async () => {
    const { project } = await projectWithVersion();
    await request(app).get(`/p/task-board-test`).expect(404);

    const slug = `task-board-${project.id}`;
    await db.update(projects).set({ publishedSlug: slug, publishedVersion: 1 }).where(eq(projects.id, project.id));
    const res = await request(app).get(`/p/${slug}`).expect(200);
    expect(res.headers["content-security-policy"]).toContain("sandbox allow-scripts");
    expect(res.text).toContain(project.liveKey);
    expect(res.text).not.toContain(project.previewKey);
    expect(res.text).toMatch(/\/runtime\/react\.[0-9a-f]{10}\.js/);

    await db.update(projects).set({ publishedVersion: null }).where(eq(projects.id, project.id));
    await request(app).get(`/p/${slug}`).expect(404);
  });
});

describe("runtime assets", () => {
  it("serves hashed, immutable, CORS-enabled bundles", async () => {
    const { owner, project } = await projectWithVersion();
    const page = await owner.agent.get(`/preview/${project.id}/1`).expect(200);
    const urls = [...page.text.matchAll(/src="(\/runtime\/[^"]+)"/g)].map((m) => m[1]!);
    expect(urls).toHaveLength(3);
    for (const url of urls) {
      const res = await request(app).get(url).expect(200);
      expect(res.headers["cache-control"]).toContain("immutable");
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    }
    await request(app).get("/runtime/nope.js").expect(404);
  });
});
