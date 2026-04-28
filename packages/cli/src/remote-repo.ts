import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { withoutLocalGitEnv } from './git-env.js';
import { hasFlag, parseFlagOrNext } from './shared.js';

export interface RemoteRepoContext {
  remoteUrl?: string;
  ref?: string;
  repoDir: string;
  rootDir: string;
  defaultInput?: string;
  keepTemp: boolean;
}

export interface RemoteRepoOptions {
  commandName: string;
  fullClone?: boolean;
}

interface ResolvedRemoteRepoTarget {
  cloneUrl: string;
  ref?: string;
  rootSubPath?: string;
  defaultInput?: string;
}

function formatGitError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const withOutput = err as Error & { stderr?: string | Buffer; stdout?: string | Buffer };
  const stderr =
    typeof withOutput.stderr === 'string'
      ? withOutput.stderr.trim()
      : Buffer.isBuffer(withOutput.stderr)
        ? withOutput.stderr.toString('utf-8').trim()
        : '';
  const stdout =
    typeof withOutput.stdout === 'string'
      ? withOutput.stdout.trim()
      : Buffer.isBuffer(withOutput.stdout)
        ? withOutput.stdout.toString('utf-8').trim()
        : '';
  return stderr || stdout || err.message;
}

function runGit(args: string[], cwd?: string): void {
  execFileSync('git', args, {
    cwd,
    env: withoutLocalGitEnv(),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function normalizeRemoteSubPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return undefined;
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`Unsupported remote repo path: ${value}`);
  }
  return parts.join('/');
}

export function resolveRemoteRepoTarget(remoteUrl: string, explicitRef?: string): ResolvedRemoteRepoTarget {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    throw new Error('Remote repo URL cannot be empty');
  }

  const candidate =
    trimmed.startsWith('github.com/') || trimmed.startsWith('www.github.com/') ? `https://${trimmed}` : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { cloneUrl: trimmed, ref: explicitRef };
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return { cloneUrl: trimmed, ref: explicitRef };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return { cloneUrl: trimmed, ref: explicitRef };
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;

  if (segments.length === 2) {
    return { cloneUrl, ref: explicitRef };
  }

  const kind = segments[2];
  if (kind === 'tree' && segments.length >= 4) {
    return {
      cloneUrl,
      ref: explicitRef ?? decodeURIComponent(segments[3]),
      rootSubPath: normalizeRemoteSubPath(segments.slice(4).map(decodeURIComponent).join('/')),
    };
  }

  if (kind === 'blob' && segments.length >= 5) {
    const filePath = normalizeRemoteSubPath(segments.slice(4).map(decodeURIComponent).join('/'));
    return {
      cloneUrl,
      ref: explicitRef ?? decodeURIComponent(segments[3]),
      rootSubPath: filePath?.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : undefined,
      defaultInput: filePath,
    };
  }

  if (kind === 'commit' && segments.length >= 4) {
    return {
      cloneUrl,
      ref: explicitRef ?? decodeURIComponent(segments[3]),
    };
  }

  return { cloneUrl, ref: explicitRef };
}

function cloneRemoteRepo(remoteUrl: string, targetDir: string, ref: string | undefined, fullClone: boolean): void {
  if (fullClone) {
    runGit(['clone', '--quiet', remoteUrl, targetDir]);
    if (ref) {
      runGit(['-C', targetDir, 'checkout', '--quiet', ref]);
    }
    return;
  }

  if (!ref) {
    runGit(['clone', '--quiet', '--depth', '1', remoteUrl, targetDir]);
    return;
  }

  try {
    runGit(['clone', '--quiet', '--depth', '1', '--branch', ref, '--single-branch', remoteUrl, targetDir]);
  } catch {
    runGit(['clone', '--quiet', '--depth', '1', remoteUrl, targetDir]);
    runGit(['-C', targetDir, 'fetch', '--quiet', '--depth', '1', 'origin', ref]);
    runGit(['-C', targetDir, 'checkout', '--quiet', 'FETCH_HEAD']);
  }
}

export async function withOptionalRemoteRepo<T>(
  args: string[],
  options: RemoteRepoOptions,
  run: (context: RemoteRepoContext) => Promise<T> | T,
): Promise<T> {
  const remoteUrl = parseFlagOrNext(args, '--git');
  if (!remoteUrl) {
    const cwd = process.cwd();
    return await run({ repoDir: cwd, rootDir: cwd, keepTemp: false });
  }

  const ref = parseFlagOrNext(args, '--ref');
  const remoteTarget = resolveRemoteRepoTarget(remoteUrl, ref);
  const keepTemp = hasFlag(args, '--keep-temp');
  const originalCwd = process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), `kern-${options.commandName}-`));

  try {
    cloneRemoteRepo(remoteTarget.cloneUrl, tempDir, remoteTarget.ref, options.fullClone ?? false);
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true });
    const refSuffix = remoteTarget.ref ? ` at ref ${remoteTarget.ref}` : '';
    throw new Error(`Failed to clone ${remoteUrl}${refSuffix}: ${formatGitError(err)}`);
  }

  const rootDir = remoteTarget.rootSubPath ? resolve(tempDir, remoteTarget.rootSubPath) : tempDir;
  if (!existsSync(rootDir)) {
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`Remote path not found in ${remoteUrl}: ${remoteTarget.rootSubPath}`);
  }

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned || keepTemp) return;
    cleaned = true;
    rmSync(tempDir, { recursive: true, force: true });
  };
  const exitHandler = (): void => cleanup();

  process.on('exit', exitHandler);
  process.chdir(tempDir);

  if (keepTemp) {
    console.error(`  [${options.commandName}] keeping temp clone at ${tempDir}`);
  }

  try {
    return await run({
      remoteUrl,
      ref: remoteTarget.ref,
      repoDir: tempDir,
      rootDir,
      defaultInput: remoteTarget.defaultInput,
      keepTemp,
    });
  } finally {
    process.chdir(originalCwd);
    process.off('exit', exitHandler);
    cleanup();
  }
}
