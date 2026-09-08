import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export { between, lastBetween, sha256Hex } from '../kern-5-rt6-void-fallthrough/k0-support.mjs';

export const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const LINKED_DIR = 'packages/core/src/kir-runtime/linked-kir-program';
export const KIR_RUNTIME_DIR = 'packages/core/src/kir-runtime';
export const DIST_ROOT = 'packages/core/dist';
export const RESERVED_LABELS_PATH = 'scripts/kern-5-d0-contracts-split/reserved-labels.json';
export const TRANSITION_PATH = 'scripts/kern-canonicalizer/d0-contracts-split-historical-transition.mjs';
export const TRANSITION_TEST_PATH =
  'scripts/kern-canonicalizer/d0-contracts-split-historical-transition.test.mjs';

export function repositoryPath(relativePath) {
  return resolve(ROOT, relativePath);
}

export function exists(relativePath) {
  return existsSync(repositoryPath(relativePath));
}

export function readRepositoryText(relativePath) {
  return readFileSync(repositoryPath(relativePath), 'utf8');
}

export function lineCount(relativePath) {
  return readRepositoryText(relativePath).split('\n').length - 1;
}

export function readLinkedSource(name) {
  return readRepositoryText(`${LINKED_DIR}/${name}`);
}

export function linkedTypeScriptNames() {
  return readdirSync(repositoryPath(LINKED_DIR))
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

export function sourceFilesUnder(relativeDirectory, extensions = ['.ts']) {
  const root = repositoryPath(relativeDirectory);
  const files = [];
  (function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
        files.push(relative(repositoryPath('.'), path).split(sep).join('/'));
      }
    }
  })(root);
  return files.sort();
}

export function compiledCorePaths() {
  const root = repositoryPath(DIST_ROOT);
  const files = [];
  (function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new TypeError(`compiled core entry ${path} must not be a symlink`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
    }
  })(root);
  return files.map((path) => relative(root, path).split(sep).join('/')).sort();
}

// The transition modules hash a length-prefixed sorted path list; reproducing it here is what lets
// the inventory rows assert the c-py-1 predecessor digest without importing the head stage.
export function hashPathInventory(paths) {
  const hash = createHash('sha256');
  for (const name of [...paths].sort()) hash.update(`${name.length}:${name}`);
  return hash.digest('hex');
}

export function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

export function importSpecifiers(source) {
  return [...source.matchAll(/from\s+'(\.\/[A-Za-z0-9._-]+\.js)'/gu)].map((match) => match[1]);
}
