/** Messages a preview iframe posts to the PromptShip workspace (window.parent). */

export type BuildErrorInfo = {
  file: string | null;
  line: number | null;
  column: number | null;
  lineText: string | null;
  message: string;
};

export type PreviewMessage =
  | { source: "promptship"; type: "ready" }
  | {
      source: "promptship";
      type: "runtime-error";
      message: string;
      stack?: string;
      componentStack?: string;
    }
  | { source: "promptship"; type: "build-error"; errors: BuildErrorInfo[] };

export function isPreviewMessage(data: unknown): data is PreviewMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: unknown }).source === "promptship" &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

/** Config the server injects into every generated-app page as window.__PROMPTSHIP__. */
export type PromptShipConfig = {
  /** Base URL of the data API ("" = same host as the page). */
  apiBase: string;
  /** Capability key selecting this app's data (preview or live). */
  appKey: string;
  env: "preview" | "live";
  appName: string;
};
