import Dockerode from 'dockerode';
import { spawn, execSync } from 'child_process';

export const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });

export async function execInContainer(containerName: string, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', containerName, 'bash', '-c', cmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout.trimEnd());
      } else {
        reject(new Error(stderr.trimEnd() || `Exit code ${code}`));
      }
    });

    child.on('error', (err: Error) => {
      reject(err);
    });
  });
}

export function execInContainerSync(containerName: string, cmd: string): string {
  try {
    return execSync(`docker exec ${containerName} bash -c ${JSON.stringify(cmd)}`, {
      encoding: 'utf-8',
    }).trimEnd();
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error(String(err));
  }
}

export async function containerExists(containerName: string): Promise<boolean> {
  try {
    const containers = await docker.listContainers({ all: true });
    return containers.some((c) => c.Names.includes(`/${containerName}`));
  } catch {
    return false;
  }
}
