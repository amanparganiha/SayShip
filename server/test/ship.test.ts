import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import type { Response as AgentResponse } from "superagent";
import request from "supertest";
import { build as viteBuild } from "vite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret } from "../src/auth/crypto";
import { generations, projects, users } from "../src/db/schema";
import { MOCK_FILES, MOCK_PLAN, taskBoardApp } from "../src/llm/mockApp";
import { registeredAgent, setupTestApp } from "./helpers";

const main = setupTestApp();
const withGitHub = setupTestApp({
  env: { GITHUB_CLIENT_ID: "gh-client", GITHUB_CLIENT_SECRET: "gh-secret", APP_URL: "http://sayship.test" },
});
afterAll(() => Promise.all([main.pool.end(), withGitHub.pool.end()]));
afterEach(() => vi.unstubAllGlobals());

async function projectWithVersion(target = main, files = MOCK_FILES) {
  const owner = await registeredAgent(target.app);
  const res = await owner.agent.post("/api/projects").send({ prompt: "A task board" }).expect(201);
  const id: number = res.body.project.id;
  await target.db.update(projects).set({ plan: MOCK_PLAN, name: MOCK_PLAN.appName }).where(eq(projects.id, id));
  await target.db.insert(generations).values({ projectId: id, version: 1, mode: "create", files });
  return { ...owner, id };
}

const binary = (res: AgentResponse, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

describe("publish", () => {
  it("publishes at a stable slug, updates the version, and unpublishes", async () => {
    const { agent, id } = await projectWithVersion();
    const first = await agent.post(`/api/projects/${id}/publish`).send({}).expect(200);
    expect(first.body.slug).toMatch(/^task-board-[a-z0-9]{6}$/);
    expect(first.body.url).toBe(`${first.body.url.split("/p/")[0]}/p/${first.body.slug}`);
    expect(first.body.version).toBe(1);
    await request(main.app).get(`/p/${first.body.slug}`).expect(200);

    await main.db.insert(generations).values({
      projectId: id,
      version: 2,
      mode: "iterate",
      files: [MOCK_FILES[0]!, { path: "App.jsx", content: taskBoardApp({ footer: "v2" }) }],
    });
    const second = await agent.post(`/api/projects/${id}/publish`).send({ version: 2 }).expect(200);
    expect(second.body).toMatchObject({ slug: first.body.slug, version: 2 });
    const page = await request(main.app).get(`/p/${first.body.slug}`).expect(200);
    expect(page.text).toContain("iteration-note");

    await agent.delete(`/api/projects/${id}/publish`).expect(204);
    await request(main.app).get(`/p/${first.body.slug}`).expect(404);
  });

  it("refuses versions that don't build, and other users' projects", async () => {
    const broken = await projectWithVersion(main, [{ path: "App.jsx", content: "export default function App( {" }]);
    const res = await broken.agent.post(`/api/projects/${broken.id}/publish`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("build_failed");

    const stranger = await registeredAgent(main.app);
    await stranger.agent.post(`/api/projects/${broken.id}/publish`).send({}).expect(404);
  });
});

describe("ZIP export", () => {
  it("downloads a Vite project containing the generated files unchanged", async () => {
    const { agent, id } = await projectWithVersion();
    const res = await agent.get(`/api/projects/${id}/versions/1/export.zip`).buffer(true).parse(binary as never).expect(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="task-board-v1.zip"');

    const files = unzipSync(new Uint8Array(res.body as Buffer));
    expect(Object.keys(files).sort()).toEqual(
      [
        ".gitignore",
        "README.md",
        "index.html",
        "package.json",
        "sayship.json",
        "src/App.jsx",
        "src/components/TaskItem.jsx",
        "src/index.css",
        "src/main.jsx",
        "src/sayship.js",
        "vite.config.js",
      ].map((f) => `task-board/${f}`),
    );
    expect(strFromU8(files["task-board/src/App.jsx"]!)).toBe(MOCK_FILES[1]!.content);
    const pkg = JSON.parse(strFromU8(files["task-board/package.json"]!));
    expect(pkg.dependencies.react).toMatch(/^\^19\./);
    expect(pkg.devDependencies.vite).toMatch(/^\^\d+\./);
    expect(JSON.parse(strFromU8(files["task-board/sayship.json"]!))).toMatchObject({ generator: "SayShip", version: 1 });
  });

  it("builds with Vite as-is (the export is reproducible)", async () => {
    const { agent, id } = await projectWithVersion();
    const res = await agent.get(`/api/projects/${id}/versions/1/export.zip`).buffer(true).parse(binary as never).expect(200);
    // Inside the repo so the export resolves react/vite/tailwind from our node_modules.
    const dir = path.resolve("server/test/.tmp", `export-${id}`);
    rmSync(dir, { recursive: true, force: true });
    for (const [name, data] of Object.entries(unzipSync(new Uint8Array(res.body as Buffer)))) {
      const target = path.join(dir, name.replace(/^task-board\//, ""));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
    try {
      await viteBuild({ root: dir, configFile: path.join(dir, "vite.config.js"), logLevel: "silent" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("GitHub export", () => {
  it("is disabled when no OAuth app is configured", async () => {
    const { agent } = await registeredAgent(main.app);
    const res = await agent.get("/api/github/connect");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("github_disabled");
  });

  it("connects via OAuth (state-checked, token encrypted at rest) and pushes one commit", async () => {
    const { agent, id, userId } = await projectWithVersion(withGitHub);

    const connect = await agent.get(`/api/github/connect?returnTo=/projects/${id}`).expect(302);
    const authorize = new URL(connect.headers.location!);
    expect(`${authorize.origin}${authorize.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(authorize.searchParams.get("client_id")).toBe("gh-client");
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://sayship.test/api/github/callback");
    expect(authorize.searchParams.get("scope")).toBe("public_repo");
    const state = authorize.searchParams.get("state")!;

    const calls: { method: string; url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, url, body });
        const json = (data: unknown, status = 200) =>
          new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
        if (url === "https://github.com/login/oauth/access_token") return json({ access_token: "gho_secret_token" });
        if (url.endsWith("/user")) return json({ login: "octocat" });
        if (url.endsWith("/user/repos")) {
          return json({ name: body.name, full_name: `octocat/${body.name}`, html_url: `https://github.com/octocat/${body.name}`, default_branch: "main", owner: { login: "octocat" } }, 201);
        }
        if (url.includes("/git/ref/heads/main")) return json({ object: { sha: "base-sha" } });
        if (url.includes("/git/commits/base-sha")) return json({ tree: { sha: "base-tree" } });
        if (url.endsWith("/git/trees")) return json({ sha: "new-tree" }, 201);
        if (url.endsWith("/git/commits")) return json({ sha: "new-commit" }, 201);
        if (url.includes("/git/refs/heads/main")) return json({ object: { sha: "new-commit" } });
        return json({ message: `unexpected ${method} ${url}` }, 500);
      }),
    );

    const callback = await agent.get(`/api/github/callback?code=abc&state=${state}`).expect(302);
    expect(callback.headers.location).toBe(`/projects/${id}?github=connected`);

    const [user] = await withGitHub.db.select().from(users).where(eq(users.id, userId));
    expect(user!.githubLogin).toBe("octocat");
    expect(user!.githubTokenEnc).not.toContain("gho_secret_token");
    expect(decryptSecret(user!.githubTokenEnc!, withGitHub.env.SESSION_SECRET)).toBe("gho_secret_token");

    const push = await agent.post(`/api/projects/${id}/export/github`).send({ repoName: "task-board" }).expect(201);
    expect(push.body).toEqual({ url: "https://github.com/octocat/task-board", fullName: "octocat/task-board" });

    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!.body as { base_tree: string; tree: { path: string }[] };
    expect(tree.base_tree).toBe("base-tree");
    expect(tree.tree.map((t) => t.path)).toEqual(expect.arrayContaining(["package.json", "src/App.jsx", "src/sayship.js"]));
    expect(calls.find((c) => c.url.includes("/git/refs/heads/main"))!.body).toEqual({ sha: "new-commit" });
  });

  it("rejects a callback whose state doesn't match", async () => {
    const { agent, id } = await projectWithVersion(withGitHub);
    await agent.get(`/api/github/connect?returnTo=/projects/${id}`).expect(302);
    const res = await agent.get(`/api/github/callback?code=abc&state=forged`).expect(302);
    expect(res.headers.location).toMatch(new RegExp(`^/projects/${id}\\?github=error`));
  });

  it("asks to connect before pushing", async () => {
    const { agent, id } = await projectWithVersion(withGitHub);
    const res = await agent.post(`/api/projects/${id}/export/github`).send({ repoName: "task-board" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("github_not_connected");
  });
});
