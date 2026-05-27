#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A consumer that stops reading our (voluminous) output — a CI/agent harness,
// or `git push | head` — closes the pipe. Without a listener the resulting
// EPIPE bubbles up as an unhandled stream error and can abort an otherwise
// passing push. Swallow it and let the natural exit code stand.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

const ZERO_SHA = '0000000000000000000000000000000000000000';
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT_WIDE_FILES = new Set([
  'biome.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.json',
]);
const ROOT_WIDE_PREFIXES = ['scripts/'];
// Packages whose codegen the differential conformance harness exercises. When
// any is in the affected set, run `check:conformance` so a Python↔Express
// parity regression is caught before the push (the harness executes both
// generated artifacts and diffs the results).
const CONFORMANCE_PACKAGES = new Set(['@kernlang/core', '@kernlang/python', '@kernlang/express']);

function run(command, args, options = {}) {
  const proc = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (options.capture) {
    if (proc.status !== 0) {
      if (options.allowFailure) return null;
      const stderr = proc.stderr?.trim();
      throw new Error(`${command} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
    }
    return proc.stdout.trim();
  }

  if (proc.status !== 0) process.exit(proc.status ?? 1);
  return '';
}

function git(args, options = {}) {
  return run('git', args, { capture: true, allowFailure: options.allowFailure });
}

export function splitLines(value) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function changedFilesFromRange(base, head, gitCommand = git) {
  return splitLines(gitCommand(['diff', '--name-only', base, head]));
}

export function defaultBranchRef(gitCommand = git) {
  const upstream = gitCommand(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], {
    allowFailure: true,
  });
  if (upstream) return upstream;

  for (const candidate of ['origin/dev', 'origin/main', 'origin/master']) {
    if (gitCommand(['rev-parse', '--verify', '--quiet', candidate], { allowFailure: true })) return candidate;
  }

  const symbolic = gitCommand(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {
    allowFailure: true,
  });
  if (symbolic) return symbolic;

  return null;
}

export function changedFilesForNewRemoteRef(localSha, gitCommand = git) {
  const defaultRef = defaultBranchRef(gitCommand);
  if (defaultRef) {
    const base = gitCommand(['merge-base', localSha, defaultRef], { allowFailure: true });
    if (base) return changedFilesFromRange(base, localSha, gitCommand);
  }

  throw new Error(
    `could not determine a base ref for new branch ${localSha}; fetch origin or set an upstream before pushing`,
  );
}

export function prePushChangedFiles(options = {}) {
  const gitCommand = options.gitCommand ?? git;
  const stdin = options.stdin ?? (process.stdin.isTTY ? '' : readFileSync(0, 'utf8'));
  const refLines = splitLines(stdin);

  if (refLines.length === 0) {
    const upstream = gitCommand(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], {
      allowFailure: true,
    });
    const head = gitCommand(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    if (upstream && head) return changedFilesFromRange(upstream, head, gitCommand);
    return [];
  }

  const files = new Set();
  for (const line of refLines) {
    const [, localSha, , remoteSha] = line.split(/\s+/u);
    if (!localSha || localSha === ZERO_SHA) continue;

    const changed =
      remoteSha && remoteSha !== ZERO_SHA
        ? changedFilesFromRange(remoteSha, localSha, gitCommand)
        : changedFilesForNewRemoteRef(localSha, gitCommand);
    for (const file of changed) files.add(file);
  }

  return [...files].sort();
}

export function workspacePackages(rootDir = repoRoot) {
  const packageRoots = ['packages'];
  const packages = [];

  for (const packageRoot of packageRoots) {
    const absoluteRoot = join(rootDir, packageRoot);
    if (!existsSync(absoluteRoot)) continue;

    const entries = readdirSync(absoluteRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(absoluteRoot, entry.name);
      const packageJsonPath = join(dir, 'package.json');
      if (!existsSync(packageJsonPath)) continue;

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      packages.push({
        relDir: relative(rootDir, dir).split(sep).join('/'),
        name: packageJson.name,
        scripts: packageJson.scripts ?? {},
      });
    }
  }

  return packages.sort((a, b) => b.relDir.length - a.relDir.length);
}

export function hasRootWideChange(changedFiles) {
  return changedFiles.some(
    (file) => ROOT_WIDE_FILES.has(file) || ROOT_WIDE_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
}

export function affectedPackages(changedFiles, packages) {
  if (hasRootWideChange(changedFiles)) {
    return [...packages].sort((a, b) => a.relDir.localeCompare(b.relDir));
  }

  const affected = new Map();

  for (const file of changedFiles) {
    for (const pkg of packages) {
      if (file === pkg.relDir || file.startsWith(`${pkg.relDir}/`)) {
        affected.set(pkg.relDir, pkg);
        break;
      }
    }
  }

  return [...affected.values()].sort((a, b) => a.relDir.localeCompare(b.relDir));
}

function runBiome(changedFiles) {
  const existingFiles = changedFiles.filter((file) => existsSync(join(repoRoot, file)));

  if (existingFiles.length === 0) {
    console.log('[pre-push] no existing pushed files detected; skipping Biome.');
    return;
  }

  console.log(`[pre-push] Biome check on ${existingFiles.length} pushed file(s)...`);
  run('pnpm', [
    'exec',
    'biome',
    'check',
    '--no-errors-on-unmatched',
    '--files-ignore-unknown=true',
    ...existingFiles,
  ]);
}

export function packageFilterArgs(packages, options = {}) {
  const includeDependents = options.includeDependents ?? false;
  return packages.flatMap((pkg) => [
    '--filter',
    includeDependents ? `...{./${pkg.relDir}}` : `./${pkg.relDir}`,
  ]);
}

export function packageRunArgs(packages, script) {
  const args = ['-r', ...packageFilterArgs(packages, { includeDependents: true })];
  if (script === 'test') args.push('--filter', '!@kernlang/review-python');
  return [...args, 'run', script];
}

function runPackageScript(packages, script) {
  const runnable = packages.filter((pkg) => pkg.name && pkg.scripts[script]);
  if (runnable.length === 0) return;

  console.log(`[pre-push] ${script} ${runnable.map((pkg) => pkg.name).join(', ')}...`);
  run('pnpm', packageRunArgs(runnable, script));
}

function ensureCliBuilt() {
  console.log('[pre-push] build @kernlang/cli for scoped KERN review...');
  run('pnpm', ['-r', '--filter', '@kernlang/cli...', 'run', 'build']);
}

function runScopedReview(packages) {
  if (process.env.KERN_PRE_PUSH_SKIP_REVIEW === '1') {
    console.log('[pre-push] KERN review skipped by KERN_PRE_PUSH_SKIP_REVIEW=1.');
    return;
  }

  const reviewTargets = packages.filter((pkg) => pkg.relDir.startsWith('packages/'));
  if (reviewTargets.length === 0) return;

  ensureCliBuilt();
  for (const pkg of reviewTargets) {
    console.log(`[pre-push] KERN review ${pkg.relDir}...`);
    // Capture review output instead of streaming it. `kern review` emits tens
    // of thousands of advisory lines; flooding an inherited stdout that a
    // consumer stops reading (CI/agent harness, piped shell) can raise SIGPIPE
    // (exit 141) that aborts an otherwise-passing push. We still gate on the
    // exit status — full output is surfaced only on failure, and a short
    // trailing summary on success.
    //
    // Run RULE-BASED only — mirror what CI's `kern review` step does. The
    // single-model LLM pass is redundant with the agon multi-engine review run
    // before every commit and with kern-guard's hosted PR review, and its
    // multi-minute round-trips were the dominant cause of pushes timing out the
    // SSH connection. We drop `--llm` AND blank KERN_LLM_API_KEY so the
    // auto-LLM path (packages/cli/.../review.ts: `!llmMode && isLLMAvailable()`)
    // can't silently re-enable the LLM whenever a key is present in the env.
    const proc = spawnSync(
      'node',
      ['packages/cli/dist/cli.js', 'review', pkg.relDir, '--recursive'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, KERN_LLM_API_KEY: '' },
      },
    );
    if (proc.error) throw proc.error;
    if (proc.status !== 0) {
      if (proc.stdout) process.stdout.write(proc.stdout);
      if (proc.stderr) process.stderr.write(proc.stderr);
      throw new Error(`kern review ${pkg.relDir} failed (exit ${proc.status ?? 'signal'})`);
    }
    for (const line of splitLines(proc.stdout ?? '').slice(-3)) console.log(`  ${line}`);
  }
}

function runConformance(packages) {
  if (process.env.KERN_PRE_PUSH_SKIP_CONFORMANCE === '1') {
    console.log('[pre-push] differential conformance skipped by KERN_PRE_PUSH_SKIP_CONFORMANCE=1.');
    return;
  }
  const triggers = packages.filter((pkg) => CONFORMANCE_PACKAGES.has(pkg.name));
  if (triggers.length === 0) return;

  console.log(`[pre-push] differential conformance (Python↔Express) — triggered by ${triggers.map((pkg) => pkg.name).join(', ')}...`);
  run('pnpm', ['check:conformance']);
}

export function main() {
  try {
    const changedFiles = prePushChangedFiles();
    const packages = workspacePackages();
    const affected = affectedPackages(changedFiles, packages);

    runBiome(changedFiles);

    if (affected.length === 0) {
      console.log('[pre-push] no workspace packages affected; skipping package build/test/review.');
      return;
    }

    console.log(`[pre-push] affected packages: ${affected.map((pkg) => pkg.name).join(', ')}`);
    runPackageScript(affected, 'build');
    runPackageScript(affected, 'test');
    // Run the cross-target parity gate before the (heavier) scoped review so a
    // portability regression fails fast.
    runConformance(affected);
    runScopedReview(affected);

    console.log('[pre-push] scoped checks passed.');
  } catch (error) {
    console.error(`[pre-push] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
