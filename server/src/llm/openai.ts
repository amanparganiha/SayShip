import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { Env } from "../env";
import { LlmError, type LlmClient } from "./types";

const MAX_COMPLETION_TOKENS = 16_000;

/**
 * gpt-5.x and o-series models are reasoning models; their default effort makes code stream
 * slowly, so they get "low" unless configured. Other models don't accept the parameter at all.
 */
export function reasoningEffortFor(model: string, configured: Env["OPENAI_REASONING_EFFORT"]) {
  if (configured) return configured;
  return /^(gpt-5|o\d)/i.test(model) ? ("low" as const) : undefined;
}

export function createOpenAiClient(env: Env): LlmClient {
  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL,
    maxRetries: 2,
    timeout: 120_000,
  });
  const model = env.OPENAI_MODEL;
  const effort = reasoningEffortFor(model, env.OPENAI_REASONING_EFFORT);
  const reasoning = effort ? { reasoning_effort: effort } : {};

  return {
    provider: "openai",
    model,

    async structured({ schema, name, system, user, signal, meter }) {
      const completion = await client.chat.completions.parse(
        {
          model,
          ...reasoning,
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: zodResponseFormat(schema, name),
        },
        { signal },
      );
      meter?.add({
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
      });

      const choice = completion.choices[0];
      if (choice?.message.refusal) throw new LlmError("refused", `The model declined: ${choice.message.refusal}`);
      if (choice?.finish_reason === "length") throw new LlmError("truncated", "The model ran out of output tokens.");
      if (!choice?.message.parsed) throw new LlmError("empty", "The model returned no structured output.");
      return choice.message.parsed as never;
    },

    async *streamText({ system, user, signal, meter }) {
      const stream = await client.chat.completions.create(
        {
          model,
          ...reasoning,
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        { signal },
      );
      for await (const chunk of stream) {
        if (chunk.usage) {
          meter?.add({ promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens });
        }
        const choice = chunk.choices[0];
        if (choice?.delta?.content) yield choice.delta.content;
        if (choice?.finish_reason === "length") {
          throw new LlmError("truncated", "The model ran out of output tokens while writing a file.");
        }
      }
    },
  };
}

/** Turns provider failures into messages a user can act on. */
export function describeProviderError(err: unknown, model: string): { code: string; message: string } | null {
  if (!(err instanceof OpenAI.APIError)) return null;
  switch (err.status) {
    case 401:
      return { code: "llm_auth", message: "OpenAI rejected the API key. Check OPENAI_API_KEY." };
    case 403:
    case 404:
      return { code: "llm_model", message: `Model "${model}" isn't available for this API key. Set OPENAI_MODEL.` };
    case 429:
      return { code: "llm_rate_limit", message: "OpenAI rate limit or quota reached. Try again in a minute." };
    case 400:
      return { code: "llm_bad_request", message: `OpenAI rejected the request: ${err.message}` };
    default:
      return { code: "llm_unavailable", message: "OpenAI is having trouble right now. Try again shortly." };
  }
}
