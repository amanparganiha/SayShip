import type { GeneratedFile, Plan } from "@shared/schemas";

/**
 * The deterministic app the mock LLM "generates". It exercises the real pipeline end to end:
 * multi-file imports, the promptship data SDK, Tailwind, forms and optimistic updates.
 */

export const MOCK_PLAN: Plan = {
  appName: "Task board",
  description: "A simple task board: add tasks, tick them off, delete them. Tasks are stored in the app's database.",
  entities: [
    {
      name: "tasks",
      fields: [
        { name: "title", type: "string" },
        { name: "done", type: "boolean" },
      ],
    },
  ],
  features: ["Add a task", "Mark tasks as done", "Delete tasks", "See how many tasks are left"],
  files: [
    { path: "components/TaskItem.jsx", purpose: "One task row with a checkbox and a delete button" },
    { path: "App.jsx", purpose: "Page layout, add-task form and the task list" },
  ],
};

export const TASK_ITEM = `export default function TaskItem({ task, onToggle, onRemove }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <input
        type="checkbox"
        className="size-4 accent-indigo-600"
        checked={Boolean(task.done)}
        onChange={() => onToggle(task)}
        aria-label={\`Mark \${task.title} as done\`}
      />
      <span className={task.done ? "flex-1 text-slate-400 line-through" : "flex-1 text-slate-800"}>
        {task.title}
      </span>
      <button onClick={() => onRemove(task.id)} className="text-sm text-slate-400 hover:text-red-600">
        Delete
      </button>
    </li>
  );
}
`;

/** App.jsx, with optional extra JSX (used by the mock iterate/fix flows). */
export function taskBoardApp(options: { footer?: string; broken?: boolean } = {}): string {
  const brokenLine = options.broken ? `  const summary = formatSummary(remaining, tasks.length);\n` : "";
  const subtitle = options.broken ? "{summary}" : "{remaining} of {tasks.length} tasks left";
  const footer = options.footer
    ? `\n        <footer data-testid="iteration-note" className="mt-8 text-center text-xs text-slate-400">${options.footer}</footer>`
    : "";

  return `import { useState } from "react";
import { useCollection } from "promptship";
import TaskItem from "./components/TaskItem";

export default function App() {
  const { items: tasks, loading, error, create, update, remove } = useCollection("tasks");
  const [title, setTitle] = useState("");
  const remaining = tasks.filter((task) => !task.done).length;
${brokenLine}
  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    create({ title: trimmed, done: false });
    setTitle("");
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <h1 className="text-3xl font-bold text-slate-900">Task board</h1>
        <p className="mt-1 text-sm text-slate-500">${subtitle}</p>

        <form onSubmit={handleSubmit} className="mt-6 flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            aria-label="New task"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 focus:border-indigo-500 focus:outline-none"
          />
          <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500">
            Add
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="mt-6 text-slate-500">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="mt-6 text-center text-slate-500">No tasks yet. Add your first one above.</p>
        ) : (
          <ul className="mt-6 space-y-2">
            {tasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={(t) => update(t.id, { done: !t.done })}
                onRemove={remove}
              />
            ))}
          </ul>
        )}${footer}
      </div>
    </main>
  );
}
`;
}

export const MOCK_FILES: GeneratedFile[] = [
  { path: "components/TaskItem.jsx", content: TASK_ITEM },
  { path: "App.jsx", content: taskBoardApp() },
];
