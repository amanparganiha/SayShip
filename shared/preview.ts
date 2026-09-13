/** Messages a preview iframe posts to the SayShip workspace (window.parent). */

export type BuildErrorInfo = {
  file: string | null;
  line: number | null;
  column: number | null;
  lineText: string | null;
  message: string;
};

export type PreviewMessage =
  | { source: "sayship"; type: "ready" }
  | {
      source: "sayship";
      type: "runtime-error";
      message: string;
      stack?: string;
      componentStack?: string;
    }
  | { source: "sayship"; type: "build-error"; errors: BuildErrorInfo[] };

export function isPreviewMessage(data: unknown): data is PreviewMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: unknown }).source === "sayship" &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

/** Config the server injects into every generated-app page as window.__SAYSHIP__. */
export type SayShipConfig = {
  /** Base URL of the data API ("" = same host as the page). */
  apiBase: string;
  /** Capability key selecting this app's data (preview or live). */
  appKey: string;
  env: "preview" | "live";
  appName: string;
};
