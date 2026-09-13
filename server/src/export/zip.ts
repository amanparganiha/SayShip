import { strToU8, zipSync } from "fflate";
import type { GeneratedFile } from "@shared/schemas";

/** Zips files under a top-level folder, e.g. task-board/src/App.jsx. */
export function zipProject(folder: string, files: GeneratedFile[]): Buffer {
  const entries = Object.fromEntries(files.map((f) => [`${folder}/${f.path}`, strToU8(f.content)]));
  return Buffer.from(zipSync(entries, { level: 6 }));
}
