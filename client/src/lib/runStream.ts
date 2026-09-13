import { createParser } from "eventsource-parser";
import type { GenerateRequest, RunEvent } from "@shared/events";
import { ApiError } from "./api";

/**
 * Starts a generation run and feeds each Server-Sent Event to `onEvent`.
 * EventSource can't POST, so this reads the fetch body stream and parses it with eventsource-parser.
 * Resolves when the stream ends; rejects on HTTP errors (quota, run in progress…) or a dropped connection.
 */
export async function streamRun(
  projectId: number,
  body: GenerateRequest,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream") || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new ApiError(res.status, data?.error ?? "http_error", data?.message ?? `Request failed (${res.status})`);
  }

  let finished = false;
  const parser = createParser({
    onEvent: (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      if (event.type === "done" || event.type === "error") finished = true;
      onEvent(event);
    },
  });

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.feed(value);
  }
  if (!finished && !signal.aborted) {
    throw new ApiError(0, "connection_lost", "Lost the connection to the server during the run.");
  }
}
