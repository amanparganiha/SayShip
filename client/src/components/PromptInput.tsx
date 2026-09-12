import { ArrowUp } from "lucide-react";
import { useState } from "react";
import { Button, Textarea } from "./ui";

export const EXAMPLE_PROMPTS = [
  "A habit tracker with daily check-ins and streaks",
  "An expense splitter for roommates that shows who owes whom",
  "A kanban board with To do, Doing and Done columns",
];

/** The "what do you want to build?" box. Ctrl/Cmd+Enter submits. */
export default function PromptInput({
  onSubmit,
  loading,
  placeholder = "Describe the app you want to build…",
}: {
  onSubmit: (prompt: string) => void;
  loading: boolean;
  placeholder?: string;
}) {
  const [prompt, setPrompt] = useState("");
  const canSubmit = prompt.trim().length >= 3 && !loading;
  const submit = () => canSubmit && onSubmit(prompt.trim());

  return (
    <div className="space-y-3">
      <div className="relative">
        <Textarea
          aria-label="App description"
          data-testid="prompt-input"
          rows={4}
          value={prompt}
          placeholder={placeholder}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          className="pr-14 text-base"
          maxLength={2000}
          autoFocus
        />
        <Button
          variant="primary"
          className="absolute bottom-3 right-3 size-9 !px-0"
          onClick={submit}
          disabled={!canSubmit}
          loading={loading}
          aria-label="Generate app"
          data-testid="generate-button"
        >
          {!loading && <ArrowUp className="size-4" />}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_PROMPTS.map((example) => (
          <button
            key={example}
            onClick={() => setPrompt(example)}
            className="rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
