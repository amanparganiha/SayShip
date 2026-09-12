/**
 * Runs first in every generated-app page. Reports errors to the PromptShip workspace (the parent
 * window) so the agent can fix them, and shims APIs the opaque-origin sandbox takes away.
 */
import type { BuildErrorInfo, PreviewMessage } from "../../shared/preview";

type Outgoing = PreviewMessage extends infer M ? (M extends PreviewMessage ? Omit<M, "source"> : never) : never;

const config = window.__PROMPTSHIP__;
const inFrame = window.parent !== window;
let errorCount = 0;

function post(message: Outgoing) {
  if (!inFrame) return;
  try {
    // The sandboxed page has an opaque origin, so "*" is the only usable target. The parent
    // verifies event.source instead of the origin.
    window.parent.postMessage({ source: "promptship", ...message }, "*");
  } catch {
    // Ignore: reporting must never break the app.
  }
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack };
  if (typeof error === "string") return { message: error };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

function reportError(error: unknown, extra: { componentStack?: string } = {}) {
  errorCount += 1;
  if (errorCount > 20) return;
  const { message, stack } = describe(error);
  post({
    type: "runtime-error",
    message: message.slice(0, 2000),
    stack: stack?.slice(0, 4000),
    componentStack: extra.componentStack?.slice(0, 4000),
  });
  if (config?.env === "preview") showToast(message);
}

function ready() {
  if (errorCount === 0) post({ type: "ready" });
}

function buildFailed(errors: BuildErrorInfo[]) {
  errorCount += 1;
  post({ type: "build-error", errors });
  const root = document.getElementById("root") ?? document.body;
  const panel = document.createElement("div");
  panel.setAttribute("style", PANEL_STYLE);
  const title = document.createElement("h1");
  title.textContent = "This app failed to build";
  title.setAttribute("style", "font-size:16px;margin:0 0 12px;color:#fca5a5");
  panel.appendChild(title);
  for (const e of errors) {
    const pre = document.createElement("pre");
    pre.setAttribute("style", "white-space:pre-wrap;margin:0 0 12px;font:12px/1.5 ui-monospace,Consolas,monospace");
    const where = e.file ? `${e.file}${e.line ? `:${e.line}:${(e.column ?? 0) + 1}` : ""}\n` : "";
    pre.textContent = `${where}${e.message}${e.lineText ? `\n\n  ${e.lineText}` : ""}`;
    panel.appendChild(pre);
  }
  root.replaceChildren(panel);
}

const PANEL_STYLE =
  "margin:24px;padding:16px 20px;border:1px solid #7f1d1d;border-radius:8px;background:#1c0a0a;color:#fecaca;font-family:system-ui,sans-serif";

let toastTimer: number | undefined;
function showToast(message: string) {
  let toast = document.getElementById("__promptship_toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "__promptship_toast";
    toast.setAttribute(
      "style",
      "position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:min(520px,calc(100vw - 24px));padding:8px 12px;border-radius:6px;background:#7f1d1d;color:#fff;font:12px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)",
    );
    document.body.appendChild(toast);
  }
  toast.textContent = `Runtime error: ${message}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast?.remove(), 6000);
}

/** localStorage/sessionStorage throw in an opaque origin; give generated code a harmless stand-in. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  try {
    void window[name].length;
  } catch {
    try {
      Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
    } catch {
      // Leave it; generated code will surface the error and the fixer can remove the usage.
    }
  }
}

window.addEventListener("error", (event) => reportError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => reportError(event.reason));

window.__promptship = { reportError, ready, buildFailed };
