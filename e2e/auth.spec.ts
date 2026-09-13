import { expect, test } from "@playwright/test";
import { signInAsGuest } from "./helpers";

test("guests can start without signing up", async ({ page }) => {
  await signInAsGuest(page);
  await expect(page.getByRole("heading", { name: "What do you want to build?" })).toBeVisible();
  await expect(page.getByText(/^guest_/)).toBeVisible();
});

test("register, log out and log back in", async ({ page }) => {
  const username = `e2e_${Date.now().toString(36)}`;
  await page.goto("/login");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText(username)).toBeVisible();

  await page.getByText(username).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL("/login");

  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Wrong username or password");

  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
});
