#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLOBALS = resolve(ROOT, 'scripts/node-test-globals.ts');

const rawArgs = process.argv.slice(2);
const patterns = [];
const includeFilters = [];
const ignoreFilters = [];
let passWithNoTests = false;

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];
  if (arg === '--passWithNoTests') {
    passWithNoTests = true;
  } else if (arg.startsWith('--testPathPatterns=')) {
    includeFilters.push(arg.slice('--testPathPatterns='.length));
  } else if (arg === '--testPathPatterns') {
    const next = rawArgs[index + 1];
    if (next) includeFilters.push(next);
    index += 1;
  } else if (arg.startsWith('--testPathIgnorePatterns=')) {
    ignoreFilters.push(arg.slice('--testPathIgnorePatterns='.length));
  } else if (arg === '--testPathIgnorePatterns') {
    const next = rawArgs[index + 1];
    if (next) ignoreFilters.push(next);
    index += 1;
  } else if (!arg.startsWith('--')) {
    patterns.push(arg);
  }
}

if (patterns.length === 0) patterns.push('tests/**/*.test.ts');

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(full, files);
    } else if (entry.endsWith('.test.ts')) files.push(full);
  }
  return files;
}

function baseDir(pattern) {
  const globIndex = pattern.search(/[*?[]/);
  if (globIndex === -1) {
    const full = resolve(pattern);
    if (!existsSync(full)) return dirname(pattern);
    return statSync(full).isDirectory() ? pattern : dirname(pattern);
  }
  const prefix = pattern.slice(0, globIndex);
  const slash = prefix.lastIndexOf('/');
  return slash === -1 ? '.' : prefix.slice(0, slash);
}

function matchesPattern(file, pattern) {
  const normalized = relative(process.cwd(), file).split(sep).join('/');
  if (!pattern.includes('*')) return normalized === pattern || normalized.endsWith(pattern);
  const suffix = pattern.split('*').at(-1) ?? '';
  const prefix = pattern.split('*')[0] ?? '';
  return normalized.startsWith(prefix) && normalized.endsWith(suffix);
}

function matchesFilter(file, filter) {
  const normalized = relative(process.cwd(), file).split(sep).join('/');
  try {
    return new RegExp(filter).test(normalized);
  } catch {
    return normalized.includes(filter);
  }
}

const files = [
  ...new Set(
    patterns.flatMap((pattern) => {
      const dir = resolve(baseDir(pattern));
      return walk(dir).filter((file) => matchesPattern(file, pattern));
    }),
  ),
]
  .filter((file) => includeFilters.length === 0 || includeFilters.some((filter) => matchesFilter(file, filter)))
  .filter((file) => !ignoreFilters.some((filter) => matchesFilter(file, filter)))
  .sort();

if (files.length === 0) {
  if (passWithNoTests) process.exit(0);
  console.error('No test files matched.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', pathToFileURL(GLOBALS).href, '--test', '--test-concurrency=1', '--test-reporter=dot', ...files],
  { env: { ...process.env, KERN_TEST_DIST: '1' }, stdio: 'inherit' },
);

if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
