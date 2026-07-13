import Dockerode from 'dockerode';
import { spawn, execSync } from 'child_process';

export const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });

// The image sets these too, but `docker exec` into a container built before that
// change still lands in the C locale, where bash mangles non-ASCII input.
// Passing them per-exec makes UTF-8 independent of when the image was built.
export const UTF8_EXEC_ENV = ['-e', 'LANG=C.UTF-8', '-e', 'LC_ALL=C.UTF-8'];

// Without -u, exec runs as root and every file the agent creates in the bind-mounted
// /workspace lands on the host owned by root, where the host user cannot edit it.
// `claude` is built with the host's uid, so the ownership survives the mount.
// It also pins tmux to one socket: root and claude would each get their own server,
// and a session started by one would be invisible to the other.
export const EXEC_USER = process.env.CONTAINER_USER || 'claude';
export const EXEC_USER_ARGS = ['-u', EXEC_USER];

export async function execInContainer(containerName: string, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['exec', ...EXEC_USER_ARGS, ...UTF8_EXEC_ENV, containerName, 'bash', '-c', cmd],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    // Chunk boundaries land on arbitrary byte offsets, so decoding each chunk on its
    // own tears multi-byte characters in half and yields U+FFFD. Decode once, at the end.
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (data: Buffer) => {
      stdout.push(data);
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr.push(data);
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf-8').trimEnd());
      } else {
        reject(new Error(Buffer.concat(stderr).toString('utf-8').trimEnd() || `Exit code ${code}`));
      }
    });

    child.on('error', (err: Error) => {
      reject(err);
    });
  });
}

export function execInContainerSync(containerName: string, cmd: string): string {
  try {
    return execSync(
      `docker exec ${EXEC_USER_ARGS.join(' ')} ${UTF8_EXEC_ENV.join(' ')} ${containerName} bash -c ${JSON.stringify(cmd)}`,
      { encoding: 'utf-8' }
    ).trimEnd();
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error(String(err));
  }
}

// tmux session names cannot contain '.' or ':' (they are target delimiters)
export function tmuxSessionName(projectName: string, prefix: string = 'claude'): string {
  return `${prefix}-${projectName.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

export async function containerExists(containerName: string): Promise<boolean> {
  try {
    const containers = await docker.listContainers({ all: true });
    return containers.some((c) => c.Names.includes(`/${containerName}`));
  } catch {
    return false;
  }
}
