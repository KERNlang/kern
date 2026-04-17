import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hasFlag, parseFlagOrNext } from './shared.js';

export interface RemoteRepoContext {
  remoteUrl?: string;
  ref?: string;
  rootDir: string;
  keepTemp: boolean;
}

export interface RemoteRepoOptions {
  commandName: string;
  fullClone?: boolean;
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
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
    return await run({ rootDir: process.cwd(), keepTemp: false });
  }

  const ref = parseFlagOrNext(args, '--ref');
  const keepTemp = hasFlag(args, '--keep-temp');
  const originalCwd = process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), `kern-${options.commandName}-`));

  try {
    cloneRemoteRepo(remoteUrl, tempDir, ref, options.fullClone ?? false);
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true });
    const refSuffix = ref ? ` at ref ${ref}` : '';
    throw new Error(`Failed to clone ${remoteUrl}${refSuffix}: ${formatGitError(err)}`);
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
    return await run({ remoteUrl, ref, rootDir: tempDir, keepTemp });
  } finally {
    process.chdir(originalCwd);
    process.off('exit', exitHandler);
    cleanup();
  }
}
