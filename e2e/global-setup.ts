import setupTestDatabase from "../server/test/global-setup.ts";

/** Same as the vitest setup: migrate the test database and start from empty tables. */
export default async function globalSetup() {
  await setupTestDatabase();
}
