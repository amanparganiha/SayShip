import type { Env } from "../env";
import { createMockClient } from "./mock";
import { createOpenAiClient } from "./openai";
import type { LlmClient } from "./types";

export function createLlm(env: Env): LlmClient {
  // NODE_ENV=test runs the mock without artificial latency.
  if (env.llmProvider === "mock") return createMockClient({ delayMs: env.NODE_ENV === "test" ? 0 : undefined });
  return createOpenAiClient(env);
}

export type { LlmClient } from "./types";
