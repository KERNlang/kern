import type { IRNode } from './types.js';

export type ExternalImportRegistry = 'host' | 'npm' | 'pypi' | 'kern';
export type ExternalImportTarget = 'all' | 'ts' | 'python';

const VALID_IMPORT_REGISTRIES = new Set(['host', 'npm', 'pypi', 'kern']);
const VALID_IMPORT_TARGETS = new Set(['all', 'ts', 'python']);

export function importRegistryOf(raw: unknown): ExternalImportRegistry {
  if (raw === undefined || raw === null || raw === '') return 'host';
  const value = String(raw).toLowerCase();
  return VALID_IMPORT_REGISTRIES.has(value) ? (value as ExternalImportRegistry) : 'host';
}

export function importTargetOf(rawTarget: unknown, rawRegistry: unknown): ExternalImportTarget {
  if (rawTarget !== undefined && rawTarget !== null && rawTarget !== '') {
    const value = String(rawTarget).toLowerCase();
    return VALID_IMPORT_TARGETS.has(value) ? (value as ExternalImportTarget) : 'all';
  }
  switch (importRegistryOf(rawRegistry)) {
    case 'npm':
      return 'ts';
    case 'pypi':
      return 'python';
    default:
      return 'all';
  }
}

export function shouldEmitImportForTarget(
  props: { registry?: unknown; target?: unknown },
  target: Exclude<ExternalImportTarget, 'all'>,
): boolean {
  const declaredTarget = importTargetOf(props.target, props.registry);
  return declaredTarget === 'all' || declaredTarget === target;
}

export function validateImportMetadata(node: IRNode): string[] {
  const props = node.props ?? {};
  const violations: string[] = [];
  const rawRegistry = props.registry;
  const rawTarget = props.target;
  const registry =
    rawRegistry === undefined || rawRegistry === null || rawRegistry === '' ? 'host' : String(rawRegistry);
  const target = rawTarget === undefined || rawTarget === null || rawTarget === '' ? '' : String(rawTarget);

  if (registry && !VALID_IMPORT_REGISTRIES.has(registry.toLowerCase())) {
    violations.push("'import registry=' must be one of host, npm, pypi, kern");
  }
  if (target && !VALID_IMPORT_TARGETS.has(target.toLowerCase())) {
    violations.push("'import target=' must be one of all, ts, python");
  }

  const normalizedRegistry = importRegistryOf(rawRegistry);
  const normalizedTarget = importTargetOf(rawTarget, rawRegistry);
  if (normalizedRegistry === 'npm' && normalizedTarget !== 'ts') {
    violations.push("'import registry=npm' must target ts or omit target= so KERN can infer ts");
  }
  if (normalizedRegistry === 'pypi' && normalizedTarget !== 'python') {
    violations.push("'import registry=pypi' must target python or omit target= so KERN can infer python");
  }

  return violations;
}
