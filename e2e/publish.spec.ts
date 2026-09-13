import { strFromU8, unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { generateApp, signInAsGuest } from "./helpers";

test("one-click publish to a public, sandboxed URL with its own data", async ({ page, browser }) => {
  await signInAsGuest(page);
  await generateApp(page, "A task board to share");

  await page.getByTestId("publish-button").click();
  await page.getByTestId("confirm-publish").click();
  const url = (await page.getByTestId("published-url").textContent())!;
  expect(url).toMatch(/\/p\/task-board-[a-z0-9]{6}$/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("live-badge")).toContainText("live v1");

  // A logged-out visitor can use the published app.
  const visitor = await browser.newContext();
  const pub = await visitor.newPage();
  const response = await pub.goto(url);
  expect(response!.status()).toBe(200);
  expect(response!.headers()["content-security-policy"]).toContain("sandbox allow-scripts");
  await pub.getByLabel("New task").fill("Visitor task");
  await pub.getByRole("button", { name: "Add" }).click();
  await expect(pub.getByText("Visitor task")).toBeVisible();
  await pub.reload();
  await expect(pub.getByText("Visitor task")).toBeVisible();

  // Live data is separate from the owner's preview data.
  await page.getByTestId("tab-data").click();
  await expect(page.getByTestId("data-panel")).not.toContainText("Visitor task");
  await page.getByRole("button", { name: "Live data" }).click();
  await expect(page.getByTestId("data-panel")).toContainText("Visitor task");

  await page.getByTestId("publish-button").click();
  await page.getByTestId("unpublish-button").click();
  await expect(page.getByTestId("live-badge")).toHaveCount(0);
  expect((await pub.goto(url))!.status()).toBe(404);
  await visitor.close();
});

test("exports a runnable Vite project as a ZIP", async ({ page }) => {
  await signInAsGuest(page);
  await generateApp(page, "A task board to export");

  await page.getByTestId("export-menu").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-zip").click()]);
  expect(download.suggestedFilename()).toBe("task-board-v1.zip");

  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  expect(Object.keys(files)).toEqual(
    expect.arrayContaining(["task-board/package.json", "task-board/src/App.jsx", "task-board/src/sayship.js"]),
  );
  expect(JSON.parse(strFromU8(files["task-board/package.json"]!)).scripts.dev).toBe("vite");
});
