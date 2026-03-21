// OpenClaw Agent Runtime - Memory Git Service
// Wraps git CLI operations for agent memory versioning

import * as fs from 'fs';
import * as path from 'path';

export interface GitCommit {
  sha: string;
  timestamp: number;
  message: string;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function spawn(args: string[], cwd: string): Promise<SpawnResult> {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

let gitAvailableCache: boolean | null = null;

export class MemoryGit {
  private repoDir: string;

  constructor(agentMemoryDir: string) {
    this.repoDir = agentMemoryDir;
  }

  static isAvailable(): boolean {
    if (process.env.GIT_MEMORY_ENABLED === 'false') {
      return false;
    }
    if (gitAvailableCache !== null) {
      return gitAvailableCache;
    }
    try {
      const result = Bun.spawnSync(['git', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      gitAvailableCache = result.exitCode === 0;
    } catch {
      gitAvailableCache = false;
    }
    if (!gitAvailableCache) {
      console.warn('[MemoryGit] git binary not found on PATH — memory versioning disabled');
    }
    return gitAvailableCache;
  }

  static resetAvailabilityCache(): void {
    gitAvailableCache = null;
  }

  private isInitialized(): boolean {
    return fs.existsSync(path.join(this.repoDir, '.git'));
  }

  async init(): Promise<void> {
    try {
      if (this.isInitialized()) {
        return;
      }
      if (!fs.existsSync(this.repoDir)) {
        fs.mkdirSync(this.repoDir, { recursive: true });
      }
      await spawn(['git', 'init'], this.repoDir);
      await spawn(['git', 'config', 'user.email', 'openclaw@local'], this.repoDir);
      await spawn(['git', 'config', 'user.name', 'OpenClaw'], this.repoDir);
    } catch (err) {
      console.error('[MemoryGit] init failed:', err);
    }
  }

  async add(filePath: string): Promise<void> {
    try {
      await spawn(['git', 'add', filePath], this.repoDir);
    } catch (err) {
      console.error('[MemoryGit] add failed:', err);
    }
  }

  async commit(message: string): Promise<void> {
    try {
      const result = await spawn(['git', 'commit', '-m', message, '--allow-empty-message'], this.repoDir);
      if (result.exitCode !== 0) {
        if (result.stdout.includes('nothing to commit') || result.stderr.includes('nothing to commit')) {
          return;
        }
        console.error('[MemoryGit] commit failed:', result.stderr);
      }
    } catch (err) {
      console.error('[MemoryGit] commit failed:', err);
    }
  }

  async log(filePath?: string, limit = 50): Promise<GitCommit[]> {
    try {
      const args = ['git', 'log', `--format=%H|%at|%s`, `-n${limit}`];
      if (filePath) {
        args.push('--', filePath);
      }
      const result = await spawn(args, this.repoDir);
      if (result.exitCode !== 0 || !result.stdout) {
        return [];
      }
      return result.stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [sha, tsStr, ...msgParts] = line.split('|');
          return {
            sha: sha ?? '',
            timestamp: Number.parseInt(tsStr ?? '0', 10),
            message: msgParts.join('|'),
          };
        });
    } catch (err) {
      console.error('[MemoryGit] log failed:', err);
      return [];
    }
  }

  async show(sha: string, filePath: string): Promise<string | null> {
    try {
      const result = await spawn(['git', 'show', `${sha}:${filePath}`], this.repoDir);
      if (result.exitCode !== 0) {
        return null;
      }
      return result.stdout;
    } catch (err) {
      console.error('[MemoryGit] show failed:', err);
      return null;
    }
  }
}
