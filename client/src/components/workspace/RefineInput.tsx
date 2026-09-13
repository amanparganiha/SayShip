import { Wand2 } from "lucide-react";
import { useState } from "react";
import { Button, Textarea } from "../ui";

/** Follow-up instructions: each one produces a new version based on the version being viewed. */
export default function RefineInput({
  onSubmit,
  disabled,
  baseNote,
}: {
  onSubmit: (instruction: string) => void;
  disabled: boolean;
  baseNote?: string;
}) {
  const [text, setText] = useState("");
  const canSubmit = text.trim().length >= 3 && !disabled;
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(text.trim());
    setText("");
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Textarea
        rows={3}
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Describe a change… e.g. add a due date to each task"
        aria-label="Describe a change"
        data-testid="refine-input"
        disabled={disabled}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-neutral-500">{baseNote}</span>
        <Button type="submit" size="sm" variant="primary" disabled={!canSubmit} data-testid="refine-submit">
          <Wand2 className="size-3.5" /> Apply change
        </Button>
      </div>
    </form>
  );
}
