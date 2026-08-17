import fs from 'fs/promises';
import path from 'path';

/**
 * Screenshots the user hands to an agent: mockups, a broken screen, a Figma frame.
 * They are not part of the project, so they live on their own volume instead of
 * being dropped in the project root — but the agent still has to open them, and it
 * only sees what is mounted into its container. Hence one volume, mounted twice:
 * here for writing, and read-only at AGENT_DIR inside the agent container.
 */
const DATA_DIR = process.env.DATA_DIR || '/data';
const STORE_DIR = path.join(DATA_DIR, 'screenshots');

/** Where the same file appears inside the agent container (see docker-compose). */
const AGENT_DIR = process.env.AGENT_SCREENSHOTS_DIR || '/screenshots';

/** The path to hand the agent — this is what gets pasted into a prompt. */
export function agentPathOf(project: string, name: string): string {
  return `${AGENT_DIR}/${project}/${name}`;
}

const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const MAX_BASE = 60;
/** Room left for the `-2`, `-3`… a name collision appends — see `save`. */
const MAX_NEW_BASE = MAX_BASE - 8;

export interface Screenshot {
  name: string;
  /** Absolute path as the agent sees it — this is what gets pasted into a prompt. */
  agentPath: string;
  size: number;
  uploadedAt: string;
}

/**
 * Names end up in a path the user reads and the agent opens, so letters stay as
 * they are — "Снимок-экрана.png" is worth more than a row of underscores. What is
 * dropped is everything that could act as syntax somewhere: separators, quotes,
 * control characters. Stripping the leading dots is what rules out `..`, and with
 * it any way out of the project's directory.
 */
function safeName(original: string): string {
  const ext = path.extname(original).toLowerCase();
  const base = path.basename(original, path.extname(original));
  const clean =
    base
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}._-]/gu, '')
      .replace(/^[.\-]+/, '')
      .slice(0, MAX_BASE) || 'screenshot';
  return `${clean}${EXTENSIONS.has(ext) ? ext : '.png'}`;
}

export function isImage(original: string): boolean {
  return EXTENSIONS.has(path.extname(original).toLowerCase());
}

function dirFor(project: string): string {
  return path.join(STORE_DIR, project);
}

/** Absolute path on the backend's filesystem, or null if the name did not come out
 *  of `safeName` — a crafted one cannot walk out of the project's directory. */
export function pathOf(project: string, name: string): string | null {
  if (name !== safeName(name)) return null;
  return path.join(dirFor(project), name);
}

export async function list(project: string): Promise<Screenshot[]> {
  let names: string[];
  try {
    names = await fs.readdir(dirFor(project));
  } catch {
    return []; // nothing uploaded for this project yet
  }

  const shots: Screenshot[] = [];
  for (const name of names) {
    if (!isImage(name)) continue;
    try {
      const stat = await fs.stat(path.join(dirFor(project), name));
      shots.push({
        name,
        agentPath: agentPathOf(project, name),
        size: stat.size,
        uploadedAt: stat.mtime.toISOString(),
      });
    } catch {
      // deleted between readdir and stat
    }
  }
  return shots.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/** Returns the stored screenshot. A name already taken gets a numeric suffix so
 *  two pastes of "image.png" do not overwrite each other. */
export async function save(project: string, original: string, data: Buffer): Promise<Screenshot> {
  const dir = dirFor(project);
  await fs.mkdir(dir, { recursive: true });

  const wanted = safeName(original);
  const ext = path.extname(wanted);
  // Trimmed so the suffix below still fits inside `safeName`'s limit — a longer name
  // would be one `safeName` rejects, leaving the file impossible to open or delete.
  const base = path.basename(wanted, ext).slice(0, MAX_NEW_BASE);

  let name = wanted;
  for (let i = 2; ; i++) {
    try {
      // wx fails instead of overwriting, which also settles the race between two
      // concurrent uploads of the same name.
      await fs.writeFile(path.join(dir, name), data, { flag: 'wx' });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      name = `${base}-${i}${ext}`;
    }
  }

  return {
    name,
    agentPath: agentPathOf(project, name),
    size: data.length,
    uploadedAt: new Date().toISOString(),
  };
}

export async function remove(project: string, name: string): Promise<boolean> {
  const file = pathOf(project, name);
  if (!file) return false;
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

/** Deleting a project should not leave its screenshots behind on the volume. */
export async function removeAll(project: string): Promise<void> {
  await fs.rm(dirFor(project), { recursive: true, force: true }).catch(() => {});
}
