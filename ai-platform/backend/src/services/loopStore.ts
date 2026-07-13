import fs from 'fs/promises';
import path from 'path';
import type { LoopState } from './loopTypes';

/**
 * Persistence for `LoopState`, one JSON file per project — same tmp→rename,
 * serialized-write pattern as `metadataService`, keyed instead of singleton
 * because a loop is per-project rather than platform-wide.
 */
const DATA_DIR = process.env.DATA_DIR || '/data';
const LOOPS_DIR = path.join(DATA_DIR, 'loops');

function fileFor(project: string): string {
  return path.join(LOOPS_DIR, `${project}.json`);
}

const cache = new Map<string, LoopState | null>();
/** Per-project write queues: a project's writes are read-modify-write, so they run one at a time. */
const writes = new Map<string, Promise<unknown>>();

export async function loadLoop(project: string): Promise<LoopState | null> {
  if (cache.has(project)) return cache.get(project) ?? null;
  try {
    const raw = JSON.parse(await fs.readFile(fileFor(project), 'utf-8')) as LoopState;
    cache.set(project, raw);
    return raw;
  } catch {
    cache.set(project, null);
    return null;
  }
}

async function persist(state: LoopState): Promise<void> {
  await fs.mkdir(LOOPS_DIR, { recursive: true });
  const file = fileFor(state.project);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await fs.rename(tmp, file);
}

/** The cache advances only after the write lands, so a failed write cannot make memory disagree with disk. */
export async function saveLoop(state: LoopState): Promise<LoopState> {
  state.updatedAt = new Date().toISOString();
  const prior = writes.get(state.project) ?? Promise.resolve();
  const run = prior.then(async () => {
    await persist(state);
    cache.set(state.project, state);
    return state;
  });
  writes.set(state.project, run.catch(() => {}));
  return run;
}

export async function clearLoop(project: string): Promise<void> {
  const prior = writes.get(project) ?? Promise.resolve();
  const run = prior.then(async () => {
    await fs.rm(fileFor(project), { force: true });
    cache.set(project, null);
  });
  writes.set(project, run.catch(() => {}));
  return run;
}
