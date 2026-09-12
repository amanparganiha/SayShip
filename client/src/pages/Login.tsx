import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Code2, Eye, Rocket, Sparkles } from "lucide-react";
import { useState } from "react";
import { Logo } from "../components/Header";
import { Button, ErrorText, Input, Label } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { keys, queryClient } from "../lib/queries";

const STEPS = [
  { icon: Sparkles, text: "Describe an app in plain English" },
  { icon: Code2, text: "Watch the plan and code stream in, file by file" },
  { icon: Eye, text: "Use it live in a sandboxed preview with a real backend" },
  { icon: Rocket, text: "Publish it to a public URL or export to GitHub" },
];

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const onSignedIn = () => queryClient.invalidateQueries({ queryKey: keys.me });
  const submit = useMutation({
    mutationFn: () =>
      api(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        json: { username, password },
      }),
    onSuccess: onSignedIn,
  });
  const guest = useMutation({
    mutationFn: () => api("/api/auth/guest", { method: "POST" }),
    onSuccess: onSignedIn,
  });

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="grid w-full max-w-4xl gap-10 md:grid-cols-2 md:items-center">
        <section className="space-y-6">
          <Logo />
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            From a sentence to a working full-stack app.
          </h1>
          <ul className="space-y-3">
            {STEPS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-neutral-300">
                <Icon className="size-4 shrink-0 text-indigo-400" /> {text}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-6 shadow-2xl">
          <Button
            variant="primary"
            className="w-full"
            loading={guest.isPending}
            onClick={() => guest.mutate()}
            data-testid="guest-login"
          >
            Try it as a guest <ArrowRight className="size-4" />
          </Button>
          <p className="mt-2 text-center text-xs text-neutral-500">No signup. You can save your work to an account later.</p>
          <ErrorText>{guest.error ? errorMessage(guest.error) : null}</ErrorText>

          <div className="my-5 flex items-center gap-3 text-xs text-neutral-600">
            <div className="h-px flex-1 bg-neutral-800" /> or <div className="h-px flex-1 bg-neutral-800" />
          </div>

          <div className="mb-4 flex rounded-md bg-neutral-950 p-1 text-sm" role="tablist">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded py-1.5 ${mode === m ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-neutral-200"}`}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <div>
              <Label htmlFor="username">Username</Label>
              <Input id="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <ErrorText>{submit.error ? errorMessage(submit.error) : null}</ErrorText>
            <Button type="submit" className="w-full" loading={submit.isPending}>
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
