import type { ZodType } from "zod";

/** Token counts summed across every model call in one generation run. */
export class UsageMeter {
  promptTokens = 0;
  completionTokens = 0;

  add(usage: { promptTokens?: number | null; completionTokens?: number | null } | null | undefined) {
    this.promptTokens += usage?.promptTokens ?? 0;
    this.completionTokens += usage?.completionTokens ?? 0;
  }
}

/** Metadata about a call: used for logs, and by the mock provider to answer deterministically. */
export type CallTrace =
  | { step: "plan"; prompt: string }
  | { step: "edit-plan"; kind: "instruction" | "runtime-error" | "build-errors"; instruction?: string }
  | { step: "write"; path: string; action: "create" | "modify"; prompt: string; instruction?: string; fix?: boolean };

type CallBase = {
  system: string;
  user: string;
  trace: CallTrace;
  signal?: AbortSignal;
  meter?: UsageMeter;
};

/** The only surface the agents use, so the provider (OpenAI, mock) is swappable. */
export interface LlmClient {
  readonly provider: "openai" | "mock";
  readonly model: string;
  /** One JSON object matching `schema` (OpenAI Structured Outputs). */
  structured<T>(args: CallBase & { schema: ZodType<T>; name: string }): Promise<T>;
  /** Plain-text completion, streamed as deltas. */
  streamText(args: CallBase): AsyncIterable<string>;
}

/** A model call that failed in a way the user should hear about in plain words. */
export class LlmError extends Error {
  constructor(
    public readonly code: "refused" | "empty" | "truncated" | "provider",
    message: string,
  ) {
    super(message);
  }
}
