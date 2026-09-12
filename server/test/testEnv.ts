/** Environment for the vitest run. Tests use their own database so they never touch dev data. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://promptship:promptship@localhost:5432/promptship_test";

export const testEnv = {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DATABASE_URL,
  SESSION_SECRET: "test-session-secret-0123456789-abcdefghij",
  LLM_PROVIDER: "mock",
  DAILY_RUN_LIMIT: "40",
  GUEST_DAILY_RUN_LIMIT: "10",
};
