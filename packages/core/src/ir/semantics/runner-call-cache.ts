export type RunnerCallCache = Map<unknown, unknown>;

export interface PreparedRunnerCallCacheKey {
  readonly encodedLength: number;
  readonly outerStrings: readonly { readonly index: number; readonly value: string }[];
  readonly terminal: string;
}

export interface RunnerCallCacheLookup {
  readonly hit: boolean;
  readonly value?: unknown;
}

interface CacheBranch {
  readonly leaves: Map<string, StructuralEntry>;
  readonly positions: Map<number, Map<string, CacheBranch>>;
}

interface CachePathStep {
  readonly child: CacheBranch;
  readonly index: number;
  readonly parent: CacheBranch;
  readonly value: string;
}

interface StructuralEntry {
  readonly branch: CacheBranch;
  readonly path: readonly CachePathStep[];
  readonly terminal: string;
}

interface CacheStore {
  readonly root: CacheBranch;
}

const stores = new WeakMap<RunnerCallCache, CacheStore>();
const structuralEntries = new WeakSet<object>();

function branch(): CacheBranch {
  return { leaves: new Map(), positions: new Map() };
}

function storeFor(cache: RunnerCallCache, create: boolean): CacheStore | undefined {
  const existing = stores.get(cache);
  if (existing || !create) return existing;
  const created = { root: branch() };
  stores.set(cache, created);
  return created;
}

function branchFor(
  cache: RunnerCallCache,
  prepared: PreparedRunnerCallCacheKey,
  create: boolean,
): { readonly branch: CacheBranch; readonly path: readonly CachePathStep[] } | undefined {
  const store = storeFor(cache, create);
  if (!store) return undefined;
  let current = store.root;
  const path: CachePathStep[] = [];
  for (const outer of prepared.outerStrings) {
    let values = current.positions.get(outer.index);
    if (!values) {
      if (!create) return undefined;
      values = new Map();
      current.positions.set(outer.index, values);
    }
    let child = values.get(outer.value);
    if (!child) {
      if (!create) return undefined;
      child = branch();
      values.set(outer.value, child);
    }
    path.push({ child, index: outer.index, parent: current, value: outer.value });
    current = child;
  }
  return { branch: current, path };
}

function empty(value: CacheBranch): boolean {
  return value.leaves.size === 0 && value.positions.size === 0;
}

function removeStructuralEntry(entry: StructuralEntry): void {
  if (entry.branch.leaves.get(entry.terminal) === entry) entry.branch.leaves.delete(entry.terminal);
  for (let index = entry.path.length - 1; index >= 0; index -= 1) {
    const step = entry.path[index];
    if (!step || !empty(step.child)) break;
    const values = step.parent.positions.get(step.index);
    if (!values || values.get(step.value) !== step.child) break;
    values.delete(step.value);
    if (values.size === 0) step.parent.positions.delete(step.index);
  }
}

function structuralEntry(value: unknown): value is StructuralEntry {
  return typeof value === 'object' && value !== null && structuralEntries.has(value);
}

export function prepareRunnerCallCacheKey(
  namespace: readonly (number | string)[],
  values: readonly unknown[],
  provenance: readonly boolean[],
): PreparedRunnerCallCacheKey | undefined {
  const outerStrings: { index: number; value: string }[] = [];
  const terminalValues = values.map((value, index) => {
    const integer = provenance[index] === true;
    if (typeof value === 'string') {
      outerStrings.push({ index, value });
      return ['outer-string', index, integer];
    }
    return ['value', value, integer];
  });
  try {
    const terminal = JSON.stringify([namespace, terminalValues]);
    return { encodedLength: terminal.length + outerStrings.length, outerStrings, terminal };
  } catch {
    return undefined;
  }
}

export function lookupRunnerCallCache(
  cache: RunnerCallCache,
  prepared: PreparedRunnerCallCacheKey,
): RunnerCallCacheLookup {
  const target = branchFor(cache, prepared, false)?.branch;
  const entry = target?.leaves.get(prepared.terminal);
  if (!entry) return { hit: false };
  if (!cache.has(entry)) {
    removeStructuralEntry(entry);
    return { hit: false };
  }
  return { hit: true, value: cache.get(entry) };
}

export function rememberRunnerCallCache(
  cache: RunnerCallCache,
  prepared: PreparedRunnerCallCacheKey,
  value: unknown,
  limit: number,
): void {
  const target = branchFor(cache, prepared, true);
  if (!target) return;
  const retained = target.branch.leaves.get(prepared.terminal);
  if (retained && cache.has(retained)) {
    cache.set(retained, value);
    return;
  }
  if (retained) removeStructuralEntry(retained);
  while (cache.size >= limit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
    if (structuralEntry(oldest)) removeStructuralEntry(oldest);
  }
  const entry: StructuralEntry = {
    branch: target.branch,
    path: target.path,
    terminal: prepared.terminal,
  };
  structuralEntries.add(entry);
  target.branch.leaves.set(prepared.terminal, entry);
  cache.set(entry, value);
}
