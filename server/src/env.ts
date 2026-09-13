import { existsSync } from "node:fs";
import { z } from "zod";

/** Treat `KEY=` (empty) in .env the same as an unset variable. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),

  LLM_PROVIDER: optional(z.enum(["openai", "mock"])),
  OPENAI_API_KEY: optional(z.string()),
  OPENAI_BASE_URL: optional(z.url()),
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
  /** reasoning_effort for reasoning models; defaults to "low" for gpt-5.x / o-series (see llm/openai.ts). */
  OPENAI_REASONING_EFFORT: optional(z.enum(["none", "minimal", "low", "medium", "high"])),

  DAILY_RUN_LIMIT: z.coerce.number().int().nonnegative().default(40),
  GUEST_DAILY_RUN_LIMIT: z.coerce.number().int().nonnegative().default(10),
  /** Runs per 24h across ALL users: a hard ceiling on model spend for a public deployment. */
  GLOBAL_DAILY_RUN_LIMIT: z.coerce.number().int().nonnegative().default(500),
  /** Reverse proxies in front of the app (Replit: 1). Decides which address req.ip reports. */
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(1),
  /** Per-IP limits; raised in E2E runs where every test signs up from localhost. */
  AUTH_ATTEMPTS_PER_15MIN: z.coerce.number().int().positive().default(30),
  GUEST_SIGNUPS_PER_HOUR: z.coerce.number().int().positive().default(5),

  /** Public base URL, used to build OAuth callback URLs. */
  APP_URL: optional(z.url()),
  GITHUB_CLIENT_ID: optional(z.string()),
  GITHUB_CLIENT_SECRET: optional(z.string()),
});

export type Env = z.infer<typeof EnvSchema> & { llmProvider: "openai" | "mock" };

/**
 * Loads `.env` (if present; real environment variables win) and validates configuration.
 * Fails fast with a readable message instead of crashing later on a missing variable.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && existsSync(".env")) {
    process.loadEnvFile(".env");
  }

  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = parsed.data;

  let llmProvider = env.LLM_PROVIDER;
  if (!llmProvider) {
    if (env.OPENAI_API_KEY) llmProvider = "openai";
    else if (env.NODE_ENV === "production") {
      throw new Error("OPENAI_API_KEY is required in production (or set LLM_PROVIDER=mock explicitly).");
    } else llmProvider = "mock";
  }
  if (llmProvider === "openai" && !env.OPENAI_API_KEY) {
    throw new Error("LLM_PROVIDER=openai requires OPENAI_API_KEY.");
  }

  return { ...env, llmProvider };
}
