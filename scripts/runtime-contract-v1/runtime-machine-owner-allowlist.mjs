import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ALLOWLIST_URL = new URL('./machine-owner-allowlist.json', import.meta.url);
const SAFE_SOURCE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[a-z0-9][a-z0-9./-]*\.ts$/u;

function fail(message) {
  throw new Error(`runtime-envelope import closure: ${message}`);
}

function loadAllowlist() {
  const text = readFileSync(ALLOWLIST_URL, 'utf8');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('machine-owner allowlist must be JSON');
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== text) fail('machine-owner allowlist must be canonical');
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify(['format', 'sourceModules'])) {
    fail('machine-owner allowlist keys drifted');
  }
  if (value.format !== 'kern.runtime.machine-owner-allowlist.v1') {
    fail('machine-owner allowlist format drifted');
  }
  if (!Array.isArray(value.sourceModules) || value.sourceModules.length === 0) {
    fail('machine-owner allowlist must contain source modules');
  }
  for (const [index, sourcePath] of value.sourceModules.entries()) {
    if (typeof sourcePath !== 'string' || !SAFE_SOURCE_PATH.test(sourcePath) || sourcePath.includes('\\')) {
      fail(`unsafe machine-owner path ${String(sourcePath)}`);
    }
    if (index > 0 && value.sourceModules[index - 1] >= sourcePath) {
      fail('machine-owner allowlist must be unique and sorted');
    }
  }
  return Object.freeze([...value.sourceModules]);
}

export const RUNTIME_MACHINE_OWNER_SOURCE_MODULES = loadAllowlist();

export function runtimeMachineOwnerPaths(rootPath, extension) {
  if (extension !== '.ts' && extension !== '.js') fail(`unsupported machine-owner extension ${extension}`);
  return new Set(
    RUNTIME_MACHINE_OWNER_SOURCE_MODULES.map((sourcePath) =>
      resolve(rootPath, sourcePath.replace(/\.ts$/u, extension)),
    ),
  );
}

export function assertExactRuntimeMachineOwners(rootPath, visited, extension) {
  const expected = runtimeMachineOwnerPaths(rootPath, extension);
  for (const path of visited) {
    if (!expected.has(path)) fail(`unapproved machine owner ${path}`);
  }
  for (const path of expected) {
    if (!visited.has(path)) fail(`approved machine owner is unreachable ${path}`);
  }
  return visited;
}
