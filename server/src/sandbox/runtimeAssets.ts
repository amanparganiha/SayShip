import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";

/** Browser-side sources bundled into generated apps (bridge, mount, sdk). Read from the repo at runtime. */
export const RUNTIME_SOURCE_DIR = path.resolve(process.cwd(), "server/runtime");

type Asset = { body: string; contentType: string };

export type RuntimeAssets = {
  files: Map<string, Asset>;
  urls: {
    bridge: string;
    tailwind: string;
    /** React development build: readable error messages for the fixer agent. */
    reactPreview: string;
    /** React production build for published apps. */
    reactLive: string;
  };
};

const require = createRequire(import.meta.url);

/**
 * React is bundled once into an IIFE that exposes the modules generated apps may import on
 * window.__sayship_modules. Generated bundles map `import ... from "react"` onto that object, so
 * every preview shares one cacheable React file instead of re-bundling it.
 */
async function bundleReact(mode: "development" | "production"): Promise<string> {
  const modules = ["react", "react-dom", "react-dom/client", "react/jsx-runtime"];
  if (mode === "development") modules.push("react/jsx-dev-runtime");
  const contents =
    modules.map((m, i) => `import * as m${i} from ${JSON.stringify(m)};`).join("\n") +
    `\nwindow.__sayship_modules = {${modules.map((m, i) => `${JSON.stringify(m)}: m${i}`).join(", ")}};\n`;

  const result = await build({
    stdin: { contents, resolveDir: process.cwd(), sourcefile: `react-${mode}.js`, loader: "js" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: mode === "production",
    define: { "process.env.NODE_ENV": JSON.stringify(mode) },
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}

async function bundleBridge(): Promise<string> {
  const result = await build({
    entryPoints: [path.join(RUNTIME_SOURCE_DIR, "bridge.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}

async function buildRuntimeAssets(): Promise<RuntimeAssets> {
  const [reactDev, reactProd, bridge, tailwind] = await Promise.all([
    bundleReact("development"),
    bundleReact("production"),
    bundleBridge(),
    readFile(require.resolve("@tailwindcss/browser"), "utf8"),
  ]);

  const files = new Map<string, Asset>();
  const add = (name: string, body: string) => {
    // Content-hashed names let browsers cache these forever.
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 10);
    const fileName = `${name}.${hash}.js`;
    files.set(fileName, { body, contentType: "text/javascript; charset=utf-8" });
    return `/runtime/${fileName}`;
  };

  return {
    files,
    urls: {
      bridge: add("bridge", bridge),
      tailwind: add("tailwind", tailwind),
      reactPreview: add("react-dev", reactDev),
      reactLive: add("react", reactProd),
    },
  };
}

let memo: Promise<RuntimeAssets> | null = null;

/** Built lazily on first use (and pre-warmed at boot in production), then kept in memory. */
export function getRuntimeAssets(): Promise<RuntimeAssets> {
  memo ??= buildRuntimeAssets().catch((err) => {
    memo = null;
    throw err;
  });
  return memo;
}
