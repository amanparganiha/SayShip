/**
 * Standalone version of PromptShip's data SDK, included in exported projects.
 *
 * Same API as the hosted SDK (useCollection / collection), but records live in this browser's
 * localStorage, so the app runs anywhere with no backend. To share data between users, replace
 * the read/write functions below with calls to your own API.
 */
import { useMemo, useSyncExternalStore } from "react";

const PREFIX = "promptship:";
const cache = new Map();
const listeners = new Map();
let lastId = Date.now();

function read(name) {
  if (!cache.has(name)) {
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem(PREFIX + name) || "[]");
    } catch {
      items = [];
    }
    cache.set(name, items);
  }
  return cache.get(name);
}

function write(name, items) {
  cache.set(name, items);
  localStorage.setItem(PREFIX + name, JSON.stringify(items));
  (listeners.get(name) || new Set()).forEach((listener) => listener());
}

function subscribe(name, listener) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(listener);
  return () => listeners.get(name).delete(listener);
}

const clean = (fields) => {
  const { id, createdAt, updatedAt, ...rest } = fields || {};
  return rest;
};

export function collection(name) {
  return {
    list: async () => read(name),
    create: async (fields) => {
      const now = new Date().toISOString();
      const record = { ...clean(fields), id: ++lastId, createdAt: now, updatedAt: now };
      write(name, [...read(name), record]);
      return record;
    },
    update: async (id, fields) => {
      let saved = null;
      write(
        name,
        read(name).map((r) => (r.id === id ? (saved = { ...r, ...clean(fields), updatedAt: new Date().toISOString() }) : r)),
      );
      return saved;
    },
    remove: async (id) => {
      write(name, read(name).filter((r) => r.id !== id));
      return true;
    },
  };
}

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function useCollection(name, options = {}) {
  const items = useSyncExternalStore(
    (listener) => subscribe(name, listener),
    () => read(name),
  );
  const { orderBy, direction = "asc" } = options;
  const sorted = useMemo(() => {
    if (!orderBy) return items;
    const sign = direction === "desc" ? -1 : 1;
    return [...items].sort((a, b) => sign * compare(a[orderBy], b[orderBy]));
  }, [items, orderBy, direction]);

  const api = collection(name);
  return {
    items: sorted,
    loading: false,
    error: null,
    create: api.create,
    update: api.update,
    remove: api.remove,
    refresh: async () => {},
  };
}
