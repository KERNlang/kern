import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  atScalarHelperHistoryCompiledPredecessor,
  validateScalarHelperHistoryCompiledInventory,
  validateScalarHelperHistoryHistoricalTransition,
} from './scalar-helper-history-transition.mjs';

export function scalarHelperHistoryOverrides(canonicalRoot, paths, historicalPaths) {
  validateScalarHelperHistoryHistoricalTransition();
  validateScalarHelperHistoryCompiledInventory([...paths].sort());
  const overrides = new Map();
  for (const path of historicalPaths) {
    const current = readFileSync(resolve(canonicalRoot, path));
    const predecessor = atScalarHelperHistoryCompiledPredecessor(path, current);
    if (!predecessor.equals(current)) overrides.set(path, predecessor);
  }
  return overrides;
}
