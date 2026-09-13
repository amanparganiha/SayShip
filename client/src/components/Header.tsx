import { useMutation } from "@tanstack/react-query";
import { ChevronDown, LogOut, UserPlus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { MeResponse } from "@shared/api";
import { api, errorMessage } from "../lib/api";
import { keys, queryClient, useMe } from "../lib/queries";
import { Badge, Button, ErrorText, Input, Label, Modal } from "./ui";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-neutral-100">
      <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#171717" />
        <path d="M16 5 L25 21 H18 L16 27 L14 21 H7 Z" fill="#818cf8" />
      </svg>
      SayShip
    </Link>
  );
}

export function Header({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  const me = useMe().data;
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-950 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Logo />
        {me?.features.llm === "mock" && (
          <Badge tone="amber" className="hidden sm:inline-flex" >
            Mock LLM
          </Badge>
        )}
        {children}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {me?.usage && (
          <span className="hidden text-xs text-neutral-500 md:inline" title="Generation runs left in the last 24 hours">
            {me.usage.remaining}/{me.usage.limit} runs left
          </span>
        )}
        <UserMenu />
      </div>
    </header>
  );
}

function UserMenu() {
  const me = useMe().data;
  const [open, setOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      // Drop everything cached for this user, then flip `me` to signed-out (App redirects to /login).
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      queryClient.setQueryData<MeResponse>(keys.me, (old) => old && { ...old, user: null, usage: null });
    },
  });

  if (!me?.user) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-800"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {me.user.username}
        {me.user.isGuest && <Badge>guest</Badge>}
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-48 rounded-md border border-neutral-800 bg-neutral-900 p-1 shadow-xl">
          {me.user.isGuest && (
            <MenuItem
              onClick={() => {
                setOpen(false);
                setUpgrading(true);
              }}
            >
              <UserPlus className="size-3.5" /> Save as account
            </MenuItem>
          )}
          <MenuItem onClick={() => logout.mutate()}>
            <LogOut className="size-3.5" /> Log out
          </MenuItem>
        </div>
      )}
      {upgrading && <UpgradeModal onClose={() => setUpgrading(false)} />}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white"
    >
      {children}
    </button>
  );
}

function UpgradeModal({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const upgrade = useMutation({
    mutationFn: () => api("/api/auth/upgrade", { method: "POST", json: { username, password } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
      onClose();
    },
  });

  return (
    <Modal title="Save your guest projects to an account" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          upgrade.mutate();
        }}
      >
        <div>
          <Label htmlFor="upgrade-username">Username</Label>
          <Input id="upgrade-username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        <div>
          <Label htmlFor="upgrade-password">Password</Label>
          <Input id="upgrade-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <ErrorText>{upgrade.error ? errorMessage(upgrade.error) : null}</ErrorText>
        <Button type="submit" variant="primary" loading={upgrade.isPending} className="w-full">
          Create account
        </Button>
      </form>
    </Modal>
  );
}
