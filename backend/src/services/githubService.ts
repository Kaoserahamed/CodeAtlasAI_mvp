/**
 * Repository acquisition.
 *
 * Security notes, since this handles untrusted input:
 *  - The clone URL is built from a validated GitHub reference, never taken
 *    verbatim from user input, so no option injection into git is possible.
 *  - A token is passed through an askpass helper rather than embedded in the
 *    URL, so it cannot leak into logs or process listings.
 *  - Deletion uses fs APIs, not a shell command. The previous implementation
 *    interpolated the path into `rmdir /s /q`, a command injection vector if
 *    a path ever contained shell metacharacters.
 *  - Clones are shallow and single-branch to bound time and disk use.
 */
import simpleGit, { SimpleGit } from 'simple-git';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { repoIdFor, RepoRef } from './repoUrlValidator';

export interface CloneResult {
  success: boolean;
  localPath: string;
  commitSha?: string;
  error?: string;
}

export class GitHubService {
  private tempDir: string;
  private maxAgeMs: number;

  constructor(options: { tempDir?: string; maxAgeMs?: number } = {}) {
    this.tempDir = options.tempDir ?? path.join(process.cwd(), '.codeatlas-repos');
    this.maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000;
  }

  get workspaceDir(): string {
    return this.tempDir;
  }

  private async ensureTempDir(): Promise<void> {
    await fsp.mkdir(this.tempDir, { recursive: true });
  }

  /** Clone a GitHub repository, optionally at a specific ref. */
  async cloneRepository(repoRef: RepoRef, ref?: string): Promise<CloneResult> {
    let localPath = '';

    try {
      await this.ensureTempDir();

      // Deterministic name; a rescan of the same repo reuses the directory.
      const safeName = `${repoRef.owner}_${repoRef.repo}`.replace(/[^A-Za-z0-9_-]/g, '_');
      localPath = path.join(this.tempDir, safeName);

      // A previous clone may be stale or partially written.
      if (fs.existsSync(localPath)) {
        await this.cleanup(localPath);
      }

      // Never let git prompt or read the operator's global credential config.
      const git: SimpleGit = simpleGit({
        config: ['credential.helper='],
      });

      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const shallow = ['--depth', '1', '--single-branch', '--no-tags'];

      if (token) {
        // Private repositories: authenticate without putting the token in the
        // URL, in argv, or in any log line.
        const askpass = `${localPath}.askpass`;
        await fsp.writeFile(
          askpass,
          [
            '#!/bin/sh',
            'case "$1" in',
            '  *Username*) echo "${CODEATLAS_GIT_USER:-x-access-token}" ;;',
            '  *Password*) echo "$CODEATLAS_GIT_TOKEN" ;;',
            'esac',
            '',
          ].join('\n'),
          { mode: 0o700 }
        );

        try {
          await git.clone(repoRef.cloneUrl, localPath, [
            ...shallow,
            '--config',
            `core.askPass=${askpass}`,
          ]);
        } finally {
          await fsp.rm(askpass, { force: true });
        }
      } else {
        // Public repositories need no credentials at all.
        await git.clone(repoRef.cloneUrl, localPath, shallow);
      }

      if (ref) {
        // A shallow clone may not contain the requested ref yet.
        await git.fetch(['--depth', '1', 'origin', ref]);
        await git.checkout(ref);
      }

      const commitSha = (await git.revparse(['HEAD'])).trim();

      return { success: true, localPath, commitSha };
    } catch (err: any) {
      const message = err?.message ?? String(err);
      let friendly = 'Failed to clone repository';

      if (/could not read Username|Authentication failed|terminal prompts disabled/i.test(message)) {
        friendly =
          'Repository is private or needs authentication. Configure a GitHub token to analyse private repositories.';
      } else if (/not found|does not exist|404/i.test(message)) {
        friendly = 'Repository not found. Check the URL and that it exists.';
      } else if (/could not resolve host/i.test(message)) {
        friendly = 'Could not reach GitHub. Check network connectivity.';
      }

      if (localPath) await this.cleanup(localPath).catch(() => undefined);
      return {
        success: false,
        localPath: '',
        error: `${friendly} (${message.slice(0, 200)})`,
      };
    }
  }

  /**
   * Remove a cloned repository.
   *
   * Uses fs APIs rather than shelling out, and refuses to delete anything
   * outside the scratch directory.
   */
  async cleanup(localPath: string): Promise<void> {
    if (!localPath) return;

    const resolved = path.resolve(localPath);
    const root = path.resolve(this.tempDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('Refusing to delete a path outside the workspace directory');
    }

    // Windows marks cloned .git files read-only, which blocks removal.
    await this.clearReadOnly(resolved);
    await fsp.rm(resolved, { recursive: true, force: true });
  }

  /** Clear the read-only bit git sets on Windows, recursively. */
  private async clearReadOnly(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.clearReadOnly(full);
      } else {
        try {
          const stat = await fsp.stat(full);
          if ((stat.mode & 0o200) === 0) {
            await fsp.chmod(full, 0o600);
          }
        } catch {
          // A file that vanished mid-cleanup is not an error.
        }
      }
    }
  }

  /** Delete clones older than the configured maximum age. */
  async cleanupOld(): Promise<void> {
    try {
      if (!fs.existsSync(this.tempDir)) return;
      const entries = await fsp.readdir(this.tempDir, { withFileTypes: true });
      const now = Date.now();

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const full = path.join(this.tempDir, entry.name);
        try {
          const stat = await fsp.stat(full);
          if (now - stat.mtimeMs > this.maxAgeMs) {
            await this.cleanup(full);
          }
        } catch {
          // Skip anything we cannot inspect.
        }
      }
    } catch {
      // Cleanup is best-effort and must never surface as a scan failure.
    }
  }

  /** Stable repository id for a validated reference. */
  static repoIdFor(ref: RepoRef): string {
    return repoIdFor(ref);
  }
}