import { expect, test } from "@playwright/test";
import { previewFrame, signInAsGuest } from "./helpers";

test("a runtime error in the preview is fixed automatically", async ({ page }) => {
  await signInAsGuest(page);
  // The mock model writes an App.jsx that throws a ReferenceError for "[broken]" prompts.
  await page.getByTestId("prompt-input").fill("A task board [broken]");
  await page.getByTestId("generate-button").click();

  const banner = page.getByTestId("error-banner");
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("error-message")).toContainText("ReferenceError: formatSummary is not defined");

  // No click needed: auto-fix sends the error to the fixer agent and builds v2.
  await expect(page.getByTestId("version-2")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("version-2")).toContainText("fixed");
  await expect(previewFrame(page).getByText("0 of 0 tasks left")).toBeVisible();
  await expect(page.locator('[data-testid="preview-frame"]')).toHaveAttribute("data-status", "ready");
  await expect(banner).toHaveCount(0);
});

test("a build error is repaired by the pipeline before the version is saved", async ({ page }) => {
  await signInAsGuest(page);
  // "[syntax]" makes the mock write App.jsx that doesn't compile; the build check catches it.
  await page.getByTestId("prompt-input").fill("A task board [syntax]");
  await page.getByTestId("generate-button").click();
  await expect(page.locator('[data-testid="run-timeline"][data-status="done"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("run-timeline")).toContainText("Build failed, repairing");
  await expect(previewFrame(page).getByRole("heading", { name: "Task board" })).toBeVisible();
  await expect(page.getByTestId("version-history").locator("li")).toHaveCount(1);
});
