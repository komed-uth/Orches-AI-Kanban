import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Reconcile rollback in place: long-running jobs retain references to their records.
function restore(target, source) {
  if (Array.isArray(source)) {
    const old = [...target];
    target.splice(
      0,
      target.length,
      ...source.map((value, i) => {
        if (value && typeof value === "object") {
          const match = value.id ? old.find((x) => x?.id === value.id) : old[i];
          if (match && typeof match === "object") {
            restore(match, value);
            return match;
          }
        }
        return structuredClone(value);
      }),
    );
    return;
  }
  for (const key of Object.keys(target))
    if (!Object.hasOwn(source, key)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      target[key] &&
      typeof target[key] === "object"
    )
      restore(target[key], value);
    else target[key] = structuredClone(value);
  }
}
export function createStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "orches.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
  );
  const initial = {
    users: [],
    sessions: [],
    invitations: [],
    projects: [],
    tasks: [],
    runs: [],
    events: [],
    settings: { capacity: 3, executable: "codex", model: "", runner: "codex" },
  };
  let state = JSON.parse(
    db.prepare("SELECT body FROM documents WHERE id=1").get()?.body ??
      JSON.stringify(initial),
  );
  const listeners = new Set();
  let depth = 0;
  let pending = [];
  const persist = () =>
    db
      .prepare(
        "INSERT INTO documents(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(JSON.stringify(state));
  const store = {
    get state() {
      return state;
    },
    transaction(fn) {
      if (depth) return fn(state);
      const previous = structuredClone(state);
      depth++;
      pending = [];
      try {
        const result = fn(state);
        persist();
        depth--;
        const events = pending;
        pending = [];
        for (const event of events)
          for (const handler of listeners) {
            try {
              handler(event);
            } catch {}
          }
        return result;
      } catch (error) {
        restore(state, previous);
        depth = 0;
        pending = [];
        throw error;
      }
    },
    event(type, data = {}) {
      let event;
      const append = () => {
        event = {
          ...data,
          id: (state.events.at(-1)?.id ?? 0) + 1,
          type,
          createdAt: new Date().toISOString(),
        };
        state.events.push(event);
        pending.push(event);
      };
      if (depth) append();
      else store.transaction(append);
      return event;
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    close() {
      db.close();
    },
  };
  return store;
}
