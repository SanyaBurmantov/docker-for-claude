import fs from 'fs/promises';
import path from 'path';

/**
 * Per-project state the platform owns rather than the project itself: which
 * projects are pinned, when each was last opened here, which agent ran in it.
 * None of it belongs in the project directory, so it lives on its own volume.
 */
const DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA_DIR, 'projects.json');

export interface ProjectMeta {
  favorite: boolean;
  /** ISO timestamp of the last time the project page was opened. */
  lastOpened: string | null;
  /** Agent the last session was started with. */
  agent: string | null;
  /**
   * Conversation id of the interactive session, chosen by us when it started.
   * The one-shot `claude -p` helpers (explain, review, commit message) run in
   * the same project directory and write transcripts of their own, so the newest
   * transcript there is often not the session the page is about. Null when the
   * running agent has no id flags, or when the session predates this record.
   */
  sessionId: string | null;
}

export type MetaStore = Record<string, ProjectMeta>;

const EMPTY: ProjectMeta = { favorite: false, lastOpened: null, agent: null, sessionId: null };

let cache: MetaStore | null = null;
/** Writes are read-modify-write, so they run one at a time. */
let writes: Promise<unknown> = Promise.resolve();

function normalize(raw: unknown): MetaStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const store: MetaStore = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Partial<ProjectMeta>;
    store[name] = {
      favorite: entry.favorite === true,
      lastOpened: typeof entry.lastOpened === 'string' ? entry.lastOpened : null,
      agent: typeof entry.agent === 'string' ? entry.agent : null,
      sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : null,
    };
  }
  return store;
}

async function load(): Promise<MetaStore> {
  if (cache) return cache;
  try {
    cache = normalize(JSON.parse(await fs.readFile(FILE, 'utf-8')));
  } catch {
    // No file yet, or it was hand-edited into something unparseable: either way
    // the dashboard should still list projects, just without pins and ordering.
    cache = {};
  }
  return cache;
}

/** Rename over the real file so a crash mid-write cannot truncate it. */
async function persist(store: MetaStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf-8');
  await fs.rename(tmp, FILE);
}

export async function getAll(): Promise<MetaStore> {
  return { ...(await load()) };
}

export function metaFor(store: MetaStore, name: string): ProjectMeta {
  return store[name] ?? EMPTY;
}

/** The cache advances only after the write lands, so a failed write cannot make
 *  memory disagree with disk. */
export async function update(name: string, patch: Partial<ProjectMeta>): Promise<ProjectMeta> {
  const run = writes.then(async () => {
    const store = await load();
    const next: ProjectMeta = { ...metaFor(store, name), ...patch };
    const nextStore = { ...store, [name]: next };
    await persist(nextStore);
    cache = nextStore;
    return next;
  });

  // A failed write must not wedge every write that follows it.
  writes = run.catch(() => {});
  return run;
}

export async function remove(name: string): Promise<void> {
  const run = writes.then(async () => {
    const store = await load();
    if (!(name in store)) return;
    const nextStore = { ...store };
    delete nextStore[name];
    await persist(nextStore);
    cache = nextStore;
  });

  writes = run.catch(() => {});
  return run;
}
