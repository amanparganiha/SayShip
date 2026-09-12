import { useEffect, useState } from "react";

type Health = { ok: boolean; db: boolean; llm: string; latencyMs: number };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">PromptShip</h1>
        <p className="text-sm text-neutral-400">AI full-stack app builder</p>
        <p className="font-mono text-xs text-neutral-500">
          {error ? `API error: ${error}` : health ? `api ok · db ok · llm ${health.llm}` : "checking api…"}
        </p>
      </div>
    </div>
  );
}
