import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createValidatedHostCompanionHistory4_6CompiledPredecessor,
} from './host-companion-history-4-6-transition-module.mjs';
import {
  createValidatedScalarHelperHistory4_6CompiledPredecessor,
} from './scalar-helper-history-4-6-transition-module.mjs';
import {
  createValidatedScalarHelperHistoryCompiledPredecessor,
} from './scalar-helper-history-transition.mjs';

export function composeScalarHelperHistoryPredecessor(registry, path, currentSource) {
  let predecessor = Buffer.from(currentSource);
  for (const transition of registry) predecessor = transition(path, predecessor);
  return predecessor;
}

export function createScalarHelperHistoryPredecessorRegistry(paths) {
  return Object.freeze([
    createValidatedScalarHelperHistory4_6CompiledPredecessor(),
    createValidatedHostCompanionHistory4_6CompiledPredecessor(),
    createValidatedScalarHelperHistoryCompiledPredecessor([...paths].sort()),
  ]);
}

export function scalarHelperHistoryOverrides(canonicalRoot, paths, historicalPaths) {
  const registry = createScalarHelperHistoryPredecessorRegistry(paths);
  const overrides = new Map();
  for (const path of historicalPaths) {
    const current = readFileSync(resolve(canonicalRoot, path));
    const predecessor = composeScalarHelperHistoryPredecessor(registry, path, current);
    if (!predecessor.equals(current)) overrides.set(path, predecessor);
  }
  return overrides;
}
