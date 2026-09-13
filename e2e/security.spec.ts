import { expect, test } from "@playwright/test";
import { generateApp, previewFrame, signInAsGuest } from "./helpers";

test("generated code runs in an opaque origin with no access to SayShip", async ({ page }) => {
  await signInAsGuest(page);
  await generateApp(page, "A task board");
  await expect(previewFrame(page).getByRole("heading", { name: "Task board" })).toBeVisible();

  const frame = page.frames().find((f) => f.url().includes("/preview/"))!;
  const probes = await frame.evaluate(async () => {
    const result: Record<string, string> = { origin: self.origin };
    try {
      result.cookie = document.cookie;
    } catch (e) {
      result.cookie = `blocked:${(e as Error).name}`;
    }
    try {
      const r = await fetch("/api/auth/me", { credentials: "include" });
      result.api = `status:${r.status}`;
    } catch {
      result.api = "blocked";
    }
    try {
      window.parent.document.title;
      result.parent = "readable";
    } catch {
      result.parent = "blocked";
    }
    return result;
  });

  expect(probes).toEqual({ origin: "null", cookie: "blocked:SecurityError", api: "blocked", parent: "blocked" });
});

test("projects and previews are private to their owner", async ({ page, browser }) => {
  await signInAsGuest(page);
  const projectId = await generateApp(page, "A private task board");

  const other = await browser.newContext();
  const intruder = await other.newPage();
  await signInAsGuest(intruder);
  expect((await intruder.request.get(`/api/projects/${projectId}`)).status()).toBe(404);
  expect((await intruder.request.get(`/api/projects/${projectId}/versions/1/export.zip`)).status()).toBe(404);
  expect((await intruder.goto(`/preview/${projectId}/1`))!.status()).toBe(404);
  await other.close();

  const anonymous = await browser.newContext();
  const anon = await anonymous.newPage();
  expect((await anon.goto(`/preview/${projectId}/1`))!.status()).toBe(401);
  await anonymous.close();
});
