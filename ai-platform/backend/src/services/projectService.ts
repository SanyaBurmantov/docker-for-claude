import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { execInContainer } from './dockerService';

const WORKSPACE_DIR = '/workspace';
const CONTAINER_NAME = 'ai-claude';

export interface Project {
  name: string;
  path: string;
  size: string;
  hasGit: boolean;
  lastActivity: string | null;
}

export interface ProjectInfo extends Project {
  gitStatus: string;
  fileCount: number;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
  return `${size} ${units[i]}`;
}

export async function scanProjects(): Promise<Project[]> {
  const entries = await fs.readdir(WORKSPACE_DIR, { withFileTypes: true });
  const projects: Project[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const projectPath = path.join(WORKSPACE_DIR, entry.name);
    const hasGit = existsSync(path.join(projectPath, '.git'));

    let size = '0 B';
    let lastActivity: string | null = null;

    try {
      const stats = await fs.stat(projectPath);
      size = formatSize(stats.size);
      lastActivity = stats.mtime.toISOString();
    } catch {
      // ignore
    }

    let hasGitStatus = hasGit;
    if (hasGit) {
      try {
        await execInContainer(CONTAINER_NAME, `cd /workspace/${entry.name} && git rev-parse --git-dir`);
      } catch {
        hasGitStatus = false;
      }
    }

    projects.push({
      name: entry.name,
      path: projectPath,
      size,
      hasGit: hasGitStatus,
      lastActivity,
    });
  }

  return projects;
}

export async function getProjectInfo(name: string): Promise<ProjectInfo> {
  const projectPath = path.join(WORKSPACE_DIR, name);
  const hasGit = existsSync(path.join(projectPath, '.git'));

  let size = '0 B';
  let lastActivity: string | null = null;
  let gitStatus = '';
  let fileCount = 0;

  try {
    const stats = await fs.stat(projectPath);
    size = formatSize(stats.size);
    lastActivity = stats.mtime.toISOString();
  } catch {
    // ignore
  }

  if (hasGit) {
    try {
      gitStatus = await execInContainer(CONTAINER_NAME, `cd /workspace/${name} && git status --porcelain`);
    } catch {
      gitStatus = 'unavailable';
    }
  }

  try {
    fileCount = await countFiles(projectPath);
  } catch {
    fileCount = 0;
  }

  return {
    name,
    path: projectPath,
    size,
    hasGit,
    lastActivity,
    gitStatus,
    fileCount,
  };
}

async function countFiles(dir: string): Promise<number> {
  let count = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.next') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countFiles(fullPath);
    } else {
      count++;
    }
  }
  return count;
}

export function isValidProjectName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes('..');
}

export function isPathSafe(base: string, target: string): boolean {
  const resolved = path.resolve(base, target);
  return resolved === base || resolved.startsWith(base + path.sep);
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export async function listFilesRecursive(dir: string, baseDir: string = dir): Promise<FileNode[]> {
  const nodes: FileNode[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.next') continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath);
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'directory',
        children: await listFilesRecursive(fullPath, baseDir),
      });
    } else {
      nodes.push({ name: entry.name, path: relPath, type: 'file' });
    }
  }

  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
  return nodes;
}

export async function readProjectFile(projectName: string, filePath: string): Promise<string> {
  const fullPath = path.join(WORKSPACE_DIR, projectName, filePath);
  if (!isPathSafe(path.join(WORKSPACE_DIR, projectName), fullPath)) {
    throw new Error('Path traversal detected');
  }
  return fs.readFile(fullPath, 'utf-8');
}

export async function writeProjectFile(projectName: string, filePath: string, content: string): Promise<void> {
  const fullPath = path.join(WORKSPACE_DIR, projectName, filePath);
  if (!isPathSafe(path.join(WORKSPACE_DIR, projectName), fullPath)) {
    throw new Error('Path traversal detected');
  }
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}
