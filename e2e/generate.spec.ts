import { expect, test } from "@playwright/test";
import { generateApp, previewFrame, signInAsGuest, waitForRun } from "./helpers";

test("prompt -> plan -> streamed files -> live preview with a real backend", async ({ page }) => {
  await signInAsGuest(page);
  await page.getByTestId("prompt-input").fill("A task board for my team");
  await page.getByTestId("generate-button").click();

  // Streaming: the plan and a file being written show up before the run finishes.
  await expect(page.getByTestId("plan-view")).toContainText("Task board");
  await expect(page.locator('[data-testid="file-tree"] [data-status="streaming"]').first()).toBeVisible();
  await waitForRun(page);

  await expect(page.getByTestId("file-App.jsx")).toBeVisible();
  await expect(page.getByTestId("file-components/TaskItem.jsx")).toBeVisible();
  await page.getByTestId("file-components/TaskItem.jsx").click();
  await expect(page.getByTestId("code-viewer")).toContainText("export default function TaskItem");

  const app = previewFrame(page);
  await expect(app.getByRole("heading", { name: "Task board" })).toBeVisible();
  await app.getByLabel("New task").fill("Write the demo script");
  await app.getByRole("button", { name: "Add" }).click();
  await expect(app.getByText("Write the demo script")).toBeVisible();

  // Stored server-side: survives a reload of the preview and shows in the Data tab.
  await page.getByRole("button", { name: "Reload preview" }).click();
  await expect(app.getByText("Write the demo script")).toBeVisible();
  await page.getByTestId("tab-data").click();
  await expect(page.getByTestId("data-panel")).toContainText("Write the demo script");
});

test("iterate creates v2; any version can be viewed and restored", async ({ page }) => {
  await signInAsGuest(page);
  await generateApp(page, "A task board");
  const app = previewFrame(page);

  await page.getByTestId("refine-input").fill("add a footer with a tip");
  await page.getByTestId("refine-submit").click();
  await waitForRun(page);
  await expect(page.getByTestId("version-2")).toBeVisible();
  await expect(app.getByTestId("iteration-note")).toHaveText("Updated: add a footer with a tip");
  await expect(page.getByTestId("file-App.jsx")).toHaveAttribute("data-status", "changed");

  await page.getByTestId("version-1").click();
  await expect(app.getByRole("heading", { name: "Task board" })).toBeVisible();
  await expect(app.getByTestId("iteration-note")).toHaveCount(0);

  await page.getByRole("button", { name: "Restore v1 as latest" }).click();
  await expect(page.getByTestId("version-3")).toBeVisible();
  await expect(page.getByTestId("version-3")).toContainText("Restored v1");
  await expect(app.getByTestId("iteration-note")).toHaveCount(0);
});
