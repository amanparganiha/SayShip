import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("."),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@shared": here("../shared") },
  },
  build: {
    outDir: here("../dist/public"),
    emptyOutDir: true,
  },
  server: {
    // Replit serves the dev workspace from *.replit.dev hosts.
    allowedHosts: true,
  },
});
