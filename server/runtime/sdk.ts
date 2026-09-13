/**
 * The "sayship" module that generated apps import:
 *
 *   import { useCollection } from "sayship";
 *   const { items, loading, error, create, update, remove } = useCollection("tasks");
 *
 * Each collection is backed by the app's own data API (/data/:appKey/:collection) on SayShip's
 * Postgres. One store per collection is shared by every component that uses it, so they stay in
 * sync; writes are optimistic and roll back if the server rejects them.
 */
import { useMemo, useSyncExternalStore } from "react";

export type AppRecord = { id: number; createdAt: string; updatedAt: string; [field: string]: unknown };
type Fields = Record<string, unknown>;

type State = { items: AppRecord[]; loaded: boolean; loading: boolean; error: string | null };

const config = window.__SAYSHIP__ ?? { apiBase: "", appKey: "", env: "preview" as const, appName: "" };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${config.apiBase}/data/${encodeURIComponent(config.appKey)}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  if (!res.ok) throw new Error(data?.message ?? `Request failed (${res.status})`);
  return data as T;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

let tempIds = 0;

class CollectionStore {
  private state: State = { items: [], loaded: false, loading: false, error: null };
  private listeners = new Set<() => void>();
  /** Temporary (negative) id of an optimistic record -> the pending server create. */
  private pending = new Map<number, Promise<AppRecord | null>>();

  constructor(private readonly name: string) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.state.loaded && !this.state.loading) void this.refresh();
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private path(id?: number) {
    return `/${encodeURIComponent(this.name)}${id === undefined ? "" : `/${id}`}`;
  }

  /** Resolves an optimistic temporary id to the real one once its create has finished. */
  private async realId(id: number): Promise<number | null> {
    if (id >= 0) return id;
    const created = await this.pending.get(id);
    return created?.id ?? null;
  }

  refresh = async () => {
    this.set({ loading: true });
    try {
      const { items } = await request<{ items: AppRecord[] }>("GET", this.path());
      this.set({ items, loaded: true, loading: false, error: null });
    } catch (e) {
      this.set({ loaded: true, loading: false, error: errorText(e) });
    }
  };

  /** Returns the saved record, or null if the server rejected it (then `error` is set). */
  create = (fields: Fields): Promise<AppRecord | null> => {
    const now = new Date().toISOString();
    const temp: AppRecord = { ...fields, id: -++tempIds, createdAt: now, updatedAt: now };
    this.set({ items: [...this.state.items, temp] });

    const promise = request<AppRecord>("POST", this.path(), fields)
      .then((saved) => {
        this.set({ items: this.state.items.map((i) => (i.id === temp.id ? saved : i)), error: null });
        return saved;
      })
      .catch((e) => {
        this.set({ items: this.state.items.filter((i) => i.id !== temp.id), error: errorText(e) });
        return null;
      })
      .finally(() => this.pending.delete(temp.id));
    this.pending.set(temp.id, promise);
    return promise;
  };

  update = async (id: number, fields: Fields): Promise<AppRecord | null> => {
    const before = this.state.items;
    this.set({ items: before.map((i) => (i.id === id ? { ...i, ...fields } : i)) });
    try {
      const realId = await this.realId(id);
      if (realId === null) return null;
      const saved = await request<AppRecord>("PATCH", this.path(realId), fields);
      this.set({ items: this.state.items.map((i) => (i.id === saved.id || i.id === id ? saved : i)), error: null });
      return saved;
    } catch (e) {
      this.set({ items: before, error: errorText(e) });
      return null;
    }
  };

  remove = async (id: number): Promise<boolean> => {
    const before = this.state.items;
    this.set({ items: before.filter((i) => i.id !== id) });
    try {
      const realId = await this.realId(id);
      if (realId !== null) await request("DELETE", this.path(realId));
      return true;
    } catch (e) {
      this.set({ items: before, error: errorText(e) });
      return false;
    }
  };
}

const stores = new Map<string, CollectionStore>();

function storeFor(name: string): CollectionStore {
  let store = stores.get(name);
  if (!store) {
    store = new CollectionStore(name);
    stores.set(name, store);
  }
  return store;
}

// Published apps are shared by many visitors: pick up their changes when the tab regains focus.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") stores.forEach((s) => void s.refresh());
});

export type CollectionOptions = { orderBy?: string; direction?: "asc" | "desc" };

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a === undefined || a === null) return b === undefined || b === null ? 0 : 1;
  if (b === undefined || b === null) return -1;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** React hook over one collection of this app's database. */
export function useCollection(name: string, options: CollectionOptions = {}) {
  const store = storeFor(name);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { orderBy, direction = "asc" } = options;

  const items = useMemo(() => {
    if (!orderBy) return state.items;
    const sign = direction === "desc" ? -1 : 1;
    return [...state.items].sort((a, b) => sign * compare(a[orderBy], b[orderBy]));
  }, [state.items, orderBy, direction]);

  return {
    items,
    loading: !state.loaded,
    error: state.error,
    create: store.create,
    update: store.update,
    remove: store.remove,
    refresh: store.refresh,
  };
}

/** Imperative access outside components (same shared store as the hook). */
export function collection(name: string) {
  const store = storeFor(name);
  return {
    list: async () => {
      await store.refresh();
      return store.getSnapshot().items;
    },
    create: store.create,
    update: store.update,
    remove: store.remove,
  };
}
