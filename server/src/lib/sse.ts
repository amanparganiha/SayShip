import type { Response } from "express";
import type { RunEvent } from "@shared/events";

/**
 * Minimal Server-Sent Events writer. `no-transform` also makes the compression middleware
 * skip this response, which would otherwise buffer the stream.
 */
export function openSse(res: Response) {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Comment lines keep proxies from closing an idle connection while the model thinks.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15_000);

  return {
    send(event: RunEvent) {
      if (res.writableEnded) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    },
    close() {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };
}
