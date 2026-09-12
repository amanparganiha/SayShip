import path from "node:path";
import { build, type Message, type OnResolveResult, type Plugin } from "esbuild";
import type { BuildErrorInfo } from "@shared/preview";
import { ENTRY_FILE, type GeneratedFile } from "@shared/schemas";
import { RUNTIME_SOURCE_DIR } from "./runtimeAssets";

export type BundleMode = "preview" | "live";
export type BundleResult = { ok: true; code: string } | { ok: false; errors: BuildErrorInfo[] };

/** Bare imports generated code may use, mapped to keys of window.__ps_modules (see runtimeAssets). */
const GLOBAL_MODULES = new Set(["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"]);

const SDK_FILE = path.join(RUNTIME_SOURCE_DIR, "sdk.ts");
const MOUNT_FILE = path.join(RUNTIME_SOURCE_DIR, "mount.tsx");
const ENTRY = "__promptship_entry__.jsx";
const ENTRY_SOURCE = `import App from "./${ENTRY_FILE}";\nimport { mount } from "promptship/runtime";\nmount(App);\n`;
const EXTENSIONS = ["", ".jsx", ".js", "/index.jsx", "/index.js"];

const fail = (text: string): OnResolveResult => ({ errors: [{ text }] });

/** Resolves every import made by generated code. Nothing here ever touches the real file system. */
function resolveFromApp(spec: string, importer: string, files: Map<string, string>): OnResolveResult {
  if (GLOBAL_MODULES.has(spec)) return { path: spec, namespace: "global" };
  if (spec === "promptship") return { path: SDK_FILE };
  if (spec === "promptship/runtime" && importer === ENTRY) return { path: MOUNT_FILE };
  if (spec.endsWith(".css")) return fail(`CSS files aren't supported ("${spec}"). Style with Tailwind classes instead.`);

  if (spec.startsWith("./") || spec.startsWith("../")) {
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(importer), spec));
    if (!joined.startsWith("..")) {
      for (const ext of EXTENSIONS) {
        if (files.has(joined + ext)) return { path: joined + ext, namespace: "app" };
      }
    }
    return fail(`Cannot find "${spec}". Available files: ${[...files.keys()].join(", ")}`);
  }

  return fail(
    `Package "${spec}" is not available. Generated apps can import only "react", "promptship" and their own files.`,
  );
}

function appPlugin(files: Map<string, string>): Plugin {
  return {
    name: "promptship-virtual-app",
    setup(b) {
      b.onResolve({ filter: /^promptship:entry$/ }, () => ({ path: ENTRY, namespace: "app" }));
      // Catch-all for imports *from* generated files, so none of them can reach the disk.
      b.onResolve({ filter: /.*/, namespace: "app" }, (args) => resolveFromApp(args.path, args.importer, files));
      // The runtime files on disk (sdk, mount) import React too.
      b.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) =>
        GLOBAL_MODULES.has(args.path) ? { path: args.path, namespace: "global" } : undefined,
      );

      b.onLoad({ filter: /.*/, namespace: "global" }, (args) => ({
        contents: `module.exports = window.__ps_modules[${JSON.stringify(args.path)}];`,
        loader: "js",
      }));
      b.onLoad({ filter: /.*/, namespace: "app" }, (args) => ({
        contents: args.path === ENTRY ? ENTRY_SOURCE : (files.get(args.path) ?? ""),
        loader: "jsx",
      }));
    },
  };
}

function toBuildError(m: Message): BuildErrorInfo {
  let file = m.location?.file ?? null;
  if (file) {
    file = file.replace(/^app:/, "");
    if (file === ENTRY) file = ENTRY_FILE;
    // Never leak server paths for errors inside our own runtime files.
    else if (path.isAbsolute(file) || file.includes("\\")) file = `promptship/${path.basename(file)}`;
  }
  return {
    file,
    line: m.location?.line ?? null,
    column: m.location?.column ?? null,
    lineText: m.location?.lineText ?? null,
    message: m.text,
  };
}

function isBuildFailure(err: unknown): err is { errors: Message[] } {
  return typeof err === "object" && err !== null && Array.isArray((err as { errors?: unknown }).errors);
}

/**
 * Bundles generated files into one IIFE with esbuild, using an in-memory file system.
 * Used both to serve previews and as the pipeline's "does it compile?" check.
 */
export async function bundleApp(files: GeneratedFile[], mode: BundleMode): Promise<BundleResult> {
  const map = new Map(files.map((f) => [f.path, f.content]));
  if (!map.has(ENTRY_FILE)) {
    return {
      ok: false,
      errors: [
        {
          file: null,
          line: null,
          column: null,
          lineText: null,
          message: `${ENTRY_FILE} is missing. Every app needs an ${ENTRY_FILE} that default-exports the root component.`,
        },
      ],
    };
  }

  try {
    const result = await build({
      entryPoints: ["promptship:entry"],
      bundle: true,
      write: false,
      outfile: "app.js",
      format: "iife",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      jsxDev: mode === "preview",
      minify: mode === "live",
      sourcemap: mode === "preview" ? "inline" : false,
      define: { "process.env.NODE_ENV": JSON.stringify(mode === "preview" ? "development" : "production") },
      plugins: [appPlugin(map)],
      absWorkingDir: process.cwd(),
      logLevel: "silent",
    });
    return { ok: true, code: result.outputFiles[0]!.text };
  } catch (err) {
    if (isBuildFailure(err)) return { ok: false, errors: err.errors.map(toBuildError) };
    throw err;
  }
}

// Generations are immutable, so a bundle for (generation id, mode) never changes.
const cache = new Map<string, Promise<BundleResult>>();
const CACHE_LIMIT = 200;

export function bundleGeneration(gen: { id: number; files: GeneratedFile[] }, mode: BundleMode): Promise<BundleResult> {
  const key = `${gen.id}:${mode}`;
  let result = cache.get(key);
  if (result) {
    // Refresh recency (Map keeps insertion order, so this is a tiny LRU).
    cache.delete(key);
  } else {
    result = bundleApp(gen.files, mode);
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  cache.set(key, result);
  return result;
}
