// Production build: client -> dist/public (Vite), server -> dist/server.js (esbuild).
// Plain Node script so the same command works on Windows and on Replit (Linux).
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

await viteBuild({ configFile: "client/vite.config.ts" });

await esbuild({
  entryPoints: ["server/src/index.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Keep node_modules as runtime imports; only our own source (and @shared) is bundled.
  packages: "external",
  tsconfig: "server/tsconfig.json",
  sourcemap: true,
  logLevel: "info",
});
