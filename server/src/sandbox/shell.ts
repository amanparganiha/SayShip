import type { Response } from "express";
import type { SayShipConfig } from "@shared/preview";
import type { BundleMode, BundleResult } from "./bundle";
import type { RuntimeAssets } from "./runtimeAssets";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** JSON that is safe inside an inline <script> (can't close the tag or break on U+2028/9). */
export const jsonForScript = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/**
 * Inline JS must not contain "</script" or "<!--" (they change how the HTML parser ends the
 * script). esbuild output only has them inside string/template/regex literals, where "<\/" and
 * "\x3C" are equivalent spellings.
 */
export const escapeInlineScript = (code: string) =>
  code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "\\x3C!--");

/** The HTML page a generated app runs in: runtime assets + the app bundle (or its build errors). */
export function renderShell(opts: {
  config: SayShipConfig;
  bundle: BundleResult;
  assets: RuntimeAssets;
  mode: BundleMode;
}): string {
  const { config, bundle, assets, mode } = opts;
  const react = mode === "preview" ? assets.urls.reactPreview : assets.urls.reactLive;
  const app = bundle.ok
    ? `<script>${escapeInlineScript(bundle.code)}</script>`
    : `<script>window.__sayship.buildFailed(${jsonForScript(bundle.errors)});</script>`;

  // crossorigin="anonymous": the page has an opaque origin, and CORS-enabled script loads keep
  // error messages from being masked as "Script error." in window.onerror.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(config.appName)}</title>
<script>window.__SAYSHIP__ = ${jsonForScript(config)};</script>
<script src="${assets.urls.bridge}" crossorigin="anonymous"></script>
<script src="${assets.urls.tailwind}" crossorigin="anonymous"></script>
<script src="${react}" crossorigin="anonymous"></script>
</head>
<body>
<div id="root"></div>
${app}
</body>
</html>`;
}

/**
 * Sends generated-app HTML inside an opaque-origin sandbox. The CSP `sandbox` directive applies
 * even when the page is opened directly (not in our iframe), so generated code can never read
 * SayShip cookies/storage or make same-origin requests with the user's session.
 * `allow-forms` is required for React onSubmit handlers to fire.
 */
export function sendSandboxed(res: Response, html: string, origin: string) {
  res.set({
    "Content-Security-Policy": [
      "sandbox allow-scripts allow-forms allow-modals allow-popups",
      `connect-src ${origin}`,
      "form-action 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join("; "),
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
  });
  res.send(html);
}

export function messagePage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#0a0a0a;color:#e5e5e5;font-family:system-ui,sans-serif">
<div style="text-align:center;max-width:420px;padding:24px"><h1 style="font-size:18px;margin:0 0 8px">${escapeHtml(title)}</h1>
<p style="color:#a3a3a3;font-size:14px;margin:0">${escapeHtml(body)}</p></div></body></html>`;
}
