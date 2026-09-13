import { useCallback, useEffect, useRef } from "react";
import type { GenerateRequest, RunEvent } from "@shared/events";
import { ApiError, errorMessage } from "../lib/api";
import { keys, queryClient } from "../lib/queries";
import { streamRun } from "../lib/runStream";
import { useWorkspace } from "../lib/workspaceStore";

/**
 * Starts generation runs for one project and pipes their events into the workspace store.
 * File deltas are batched per animation frame so fast streams don't re-render per token.
 */
export function useRunner(projectId: number) {
  const controllerRef = useRef<AbortController | null>(null);
  const lastRequest = useRef<GenerateRequest | null>(null);
  const mountedRef = useRef(false);

  const start = useCallback(
    async (body: GenerateRequest) => {
      const store = useWorkspace.getState();
      if (store.run?.status === "running") return;
      lastRequest.current = body;
      const controller = new AbortController();
      controllerRef.current = controller;

      let pending = new Map<string, string>();
      let frame = 0;
      const flush = () => {
        frame = 0;
        if (pending.size === 0) return;
        const batch = pending;
        pending = new Map();
        useWorkspace.getState().appendDeltas(batch);
      };

      const onEvent = (event: RunEvent) => {
        if (event.type === "file_delta") {
          pending.set(event.path, (pending.get(event.path) ?? "") + event.delta);
          frame ||= requestAnimationFrame(flush);
          return;
        }
        flush(); // keep deltas ordered before file_done & co.
        useWorkspace.getState().applyEvent(event);
        if (event.type === "done") {
          void queryClient.invalidateQueries({ queryKey: keys.project(projectId) });
          void queryClient.invalidateQueries({ queryKey: keys.projects });
        }
        if (event.type === "done" || event.type === "error") void queryClient.invalidateQueries({ queryKey: keys.me });
      };

      try {
        await streamRun(projectId, body, onEvent, controller.signal);
      } catch (err) {
        if (!controller.signal.aborted) {
          useWorkspace.getState().failRun({
            code: err instanceof ApiError ? err.code : "error",
            message: errorMessage(err),
          });
        }
      } finally {
        if (frame) cancelAnimationFrame(frame);
        flush();
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [projectId],
  );

  const retry = useCallback(() => {
    if (lastRequest.current) void start(lastRequest.current);
  }, [start]);

  // Abort the stream (and the server-side run) when the workspace really unmounts. The deferred
  // check skips React StrictMode's simulated unmount/remount, which keeps refs.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      setTimeout(() => {
        if (!mountedRef.current) controllerRef.current?.abort();
      }, 0);
    };
  }, []);

  return { start, retry };
}
