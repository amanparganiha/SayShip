import { expect, type Page } from "@playwright/test";

export async function signInAsGuest(page: Page) {
  await page.goto("/login");
  await page.getByTestId("guest-login").click();
  await expect(page).toHaveURL("/");
}

/** Submits a prompt from the dashboard and waits for the first version to finish. Returns the project id. */
export async function generateApp(page: Page, prompt: string): Promise<number> {
  await page.getByTestId("prompt-input").fill(prompt);
  await page.getByTestId("generate-button").click();
  await expect(page).toHaveURL(/\/projects\/\d+$/);
  await waitForRun(page);
  return Number(new URL(page.url()).pathname.split("/").pop());
}

export async function waitForRun(page: Page) {
  await expect(page.locator('[data-testid="run-timeline"][data-status="done"]')).toBeVisible({ timeout: 30_000 });
}

export const previewFrame = (page: Page) => page.frameLocator('[data-testid="preview-frame"]');
