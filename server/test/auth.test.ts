import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password";
import { PASSWORD, registeredAgent, setupTestApp, uniqueName } from "./helpers";

const { app, pool } = setupTestApp();
afterAll(() => pool.end());

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("s3cret-password", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
    expect(await verifyPassword("anything", "garbage")).toBe(false);
  });
});

describe("auth routes", () => {
  it("registers, reports /me with usage, logs out", async () => {
    const { agent, username } = await registeredAgent(app);

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.user).toMatchObject({ username, isGuest: false });
    expect(me.body.usage).toEqual({ used: 0, limit: 40, remaining: 40 });
    expect(me.body.features).toEqual({ llm: "mock", github: false });

    await agent.post("/api/auth/logout").expect(204);
    const after = await agent.get("/api/auth/me").expect(200);
    expect(after.body.user).toBeNull();
  });

  it("sets an httpOnly, SameSite=Lax session cookie", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ username: uniqueName(), password: PASSWORD })
      .expect(201);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/ps_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it("rejects duplicate and invalid usernames", async () => {
    const { username } = await registeredAgent(app);
    const dup = await request(app).post("/api/auth/register").send({ username, password: PASSWORD });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("username_taken");

    const bad = await request(app).post("/api/auth/register").send({ username: "No Spaces!", password: PASSWORD });
    expect(bad.status).toBe(400);
    const reserved = await request(app).post("/api/auth/register").send({ username: "guest_abc", password: PASSWORD });
    expect(reserved.status).toBe(400);
    const short = await request(app).post("/api/auth/register").send({ username: uniqueName(), password: "short" });
    expect(short.status).toBe(400);
  });

  it("logs in with the right password only (usernames are case-insensitive)", async () => {
    const { username } = await registeredAgent(app);
    const wrong = await request(app).post("/api/auth/login").send({ username, password: "nope-nope-nope" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("invalid_credentials");

    const unknown = await request(app).post("/api/auth/login").send({ username: "nobody_here", password: PASSWORD });
    expect(unknown.status).toBe(401);

    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ username: username.toUpperCase(), password: PASSWORD }).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.user.username).toBe(username);
  });

  it("creates guests with a smaller quota and upgrades them to accounts", async () => {
    const agent = request.agent(app);
    const guest = await agent.post("/api/auth/guest").expect(201);
    expect(guest.body.user.isGuest).toBe(true);
    expect(guest.body.user.username).toMatch(/^guest_/);

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.usage.limit).toBe(10);

    const username = uniqueName("up");
    const upgraded = await agent.post("/api/auth/upgrade").send({ username, password: PASSWORD }).expect(200);
    expect(upgraded.body.user).toMatchObject({ username, isGuest: false, id: guest.body.user.id });

    await request(app).post("/api/auth/login").send({ username, password: PASSWORD }).expect(200);
    // Already a full account now.
    await agent.post("/api/auth/upgrade").send({ username: uniqueName(), password: PASSWORD }).expect(400);
  });
});

describe("CSRF origin check", () => {
  it("blocks cross-origin and sandboxed (null) origins on writes", async () => {
    const evil = await request(app)
      .post("/api/auth/guest")
      .set("Host", "promptship.test")
      .set("Origin", "https://evil.example");
    expect(evil.status).toBe(403);
    expect(evil.body.error).toBe("bad_origin");

    const sandboxed = await request(app).post("/api/auth/guest").set("Host", "promptship.test").set("Origin", "null");
    expect(sandboxed.status).toBe(403);
  });

  it("allows same-origin writes and all reads", async () => {
    await request(app)
      .post("/api/auth/guest")
      .set("Host", "promptship.test")
      .set("Origin", "https://promptship.test")
      .expect(201);
    await request(app).get("/api/auth/me").set("Origin", "https://evil.example").expect(200);
  });
});
