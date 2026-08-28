#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const allowedBuildSegments = new Set([
  'pnpm --filter @kernlang/core build',
  'pnpm --filter @kernlang/cli build',
]);

const nodeSegmentPattern = /^node(?: (?:[A-Za-z0-9_@./:,*=+-]+|"[A-Za-z0-9_@./:,*=+-]+"|'[A-Za-z0-9_@./:,*=+-]+'))+$/u;

function nodeArgs(segment) {
  if (!nodeSegmentPattern.test(segment)) {
    throw new Error(`prebuilt semantic command is not an approved node-only segment: ${segment}`);
  }
  const tokens = segment.match(/"[^"]*"|'[^']*'|[^\s]+/gu) ?? [];
  if (tokens[0] !== 'node') throw new Error(`prebuilt semantic command must invoke node: ${segment}`);
  return tokens.slice(1).map((token) => {
    const quoted = (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"));
    const value = quoted ? token.slice(1, -1) : token;
    if (/(?:^|\/)\.\.(?:\/|$)/u.test(value)) {
      throw new Error(`prebuilt semantic command may not escape the repository: ${segment}`);
    }
    return value;
  });
}

function expandBasenameGlob(argument, cwd) {
  if (!argument.includes('*')) return [argument];
  const firstStar = argument.indexOf('*');
  if (firstStar !== argument.lastIndexOf('*')) {
    throw new Error(`prebuilt semantic glob may contain only one wildcard: ${argument}`);
  }
  const directory = path.dirname(argument);
  const basename = path.basename(argument);
  if (directory.includes('*')) throw new Error(`prebuilt semantic glob must be confined to a basename: ${argument}`);
  const [prefix, suffix] = basename.split('*');
  const matches = readdirSync(path.resolve(cwd, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(suffix))
    .map((entry) => path.join(directory, entry.name))
    .sort();
  if (matches.length === 0) throw new Error(`prebuilt semantic glob matched no files: ${argument}`);
  return matches;
}

export function nodeInvocation(segment, cwd = repoRoot) {
  return {
    command: process.execPath,
    args: nodeArgs(segment).flatMap((argument) => expandBasenameGlob(argument, cwd)),
  };
}

export function prebuiltSegments(packageJson, scriptName) {
  if (!scriptName.startsWith('test:kern-')) {
    throw new Error(`prebuilt runner only accepts a concrete test:kern-* script, got ${scriptName}`);
  }
  const script = packageJson.scripts?.[scriptName];
  if (typeof script !== 'string') throw new Error(`unknown package script ${scriptName}`);

  const segments = script.split(' && ').map((segment) => segment.trim());
  let firstTestSegment = 0;
  while (allowedBuildSegments.has(segments[firstTestSegment])) firstTestSegment += 1;
  if (firstTestSegment === 0) {
    throw new Error(`${scriptName} does not start with an approved build preamble`);
  }

  const runnable = segments.slice(firstTestSegment);
  if (runnable.length === 0) throw new Error(`${scriptName} contains no test command after its build preamble`);
  for (const segment of runnable) {
    if (/^pnpm\s+test:/u.test(segment)) {
      throw new Error(`${scriptName} is an aggregate; select one concrete leaf script instead`);
    }
    if (/^pnpm\b.*\bbuild(?::[\w-]+)?(?:\s|$)/u.test(segment)) {
      throw new Error(`${scriptName} contains a build outside its leading preamble: ${segment}`);
    }
    nodeArgs(segment);
  }
  return runnable;
}

export function runPrebuiltScript(packageJson, scriptName, options = {}) {
  const cwd = options.cwd ?? repoRoot;
  const spawn = options.spawn ?? spawnSync;
  for (const segment of prebuiltSegments(packageJson, scriptName)) {
    const invocation = nodeInvocation(segment, cwd);
    const result = spawn(invocation.command, invocation.args, {
      cwd,
      env: options.env ?? process.env,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

function main() {
  const [scriptName, ...extra] = process.argv.slice(2);
  if (!scriptName || extra.length > 0) {
    console.error('usage: node scripts/ci/run-prebuilt-test.mjs <test:kern-...>');
    return 2;
  }
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  try {
    return runPrebuiltScript(packageJson, scriptName);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main();
}
