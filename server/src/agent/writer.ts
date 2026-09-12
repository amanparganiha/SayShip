import type { GeneratedFile, Plan } from "@shared/schemas";
import type { LlmClient, UsageMeter } from "../llm/types";
import { WRITER_SYSTEM } from "./prompts";

export type WriteTask = {
  plan: Plan;
  /** Files that exist right now (already written in this run, or the current version when editing). */
  files: GeneratedFile[];
  path: string;
  action: "create" | "modify";
  /** Plan purpose (create) or the editor's instructions (modify). */
  instructions: string;
  /** The original user prompt, for context. */
  prompt: string;
  /** When editing: the user's instruction, or the error report being fixed. */
  changeRequest?: string;
  /** When editing: the editor's one-line summary of the overall change. */
  changeSummary?: string;
  fix?: boolean;
};

const fileBlock = (f: GeneratedFile) => `--- ${f.path} ---\n${f.content.trimEnd()}\n`;

export function writerUserMessage(task: WriteTask): string {
  const others = task.files.filter((f) => f.path !== task.path);
  const current = task.files.find((f) => f.path === task.path);
  const parts = [
    `Original app idea:\n${task.prompt}`,
    `App plan (JSON):\n${JSON.stringify(task.plan, null, 2)}`,
    others.length > 0
      ? `Files that already exist (you may import these):\n\n${others.map(fileBlock).join("\n")}`
      : "No other files exist yet.",
  ];

  if (task.action === "create") {
    const later = task.plan.files.filter((f) => f.path !== task.path && !task.files.some((x) => x.path === f.path));
    parts.push(
      `Write the file: ${task.path}\nIts purpose: ${task.instructions}` +
        (later.length ? `\nNot written yet, so do NOT import: ${later.map((f) => f.path).join(", ")}` : ""),
    );
  } else {
    if (current) parts.push(`Current content of ${task.path}:\n\n${fileBlock(current)}`);
    if (task.changeRequest) parts.push(`${task.fix ? "Error being fixed" : "Requested change"}:\n${task.changeRequest}`);
    if (task.changeSummary) parts.push(`Overall change across files: ${task.changeSummary}`);
    parts.push(
      `${current ? "Rewrite" : "Create"} the file: ${task.path}\nWhat to do in this file: ${task.instructions}\nOutput the complete new content of ${task.path}.`,
    );
  }
  return parts.join("\n\n");
}

/** Streams the raw model output for one file. Use {@link FenceFilter} / {@link stripFences} on it. */
export function writeFile(
  llm: LlmClient,
  task: WriteTask,
  opts: { signal?: AbortSignal; meter?: UsageMeter },
): AsyncIterable<string> {
  return llm.streamText({
    system: WRITER_SYSTEM,
    user: writerUserMessage(task),
    trace: {
      step: "write",
      path: task.path,
      action: task.action,
      prompt: task.prompt,
      instruction: task.changeRequest,
      fix: task.fix,
    },
    ...opts,
  });
}

const OPEN_FENCE = /^\s*```[\w.-]*[^\n]*\n/;

/** Removes a markdown code fence the model may have wrapped the file in, despite instructions. */
export function stripFences(text: string): string {
  let out = text.replace(/^\uFEFF/, "");
  if (OPEN_FENCE.test(out)) {
    out = out.replace(OPEN_FENCE, "");
    out = out.replace(/\n?```\s*$/, "");
  }
  return out.trimEnd() + "\n";
}

/**
 * Streaming counterpart of stripFences for live display: holds back the start of the output
 * until it's clear whether it opens with a fence, then passes text through.
 */
export class FenceFilter {
  private head = "";
  private decided = false;

  push(delta: string): string {
    if (this.decided) return delta;
    this.head += delta;
    const trimmed = this.head.trimStart();
    if (trimmed.startsWith("```")) {
      // Drop the opening fence line (e.g. "```jsx") once it is complete.
      const newline = this.head.indexOf("\n", this.head.indexOf("```"));
      return newline === -1 ? "" : this.release(this.head.slice(newline + 1));
    }
    // "", "`" or "``" could still turn into a fence: wait for more output.
    if ("```".startsWith(trimmed)) return "";
    return this.release(this.head);
  }

  private release(text: string): string {
    this.decided = true;
    this.head = "";
    return text;
  }
}
