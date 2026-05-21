// @kern-source: import-metadata:1
export type ExternalImportRegistry = 'host' | 'npm' | 'pypi' | 'kern';

// @kern-source: import-metadata:2
export type ExternalImportTarget = 'all' | 'ts' | 'python' | 'react' | 'node' | 'express' | 'cli' | 'lib' | 'mcp' | 'terminal' | 'ink' | 'vue' | 'nuxt' | 'nextjs' | 'native' | 'web' | 'fastapi';

// @kern-source: import-metadata:3
export type CapabilityRuntime = 'node' | 'python' | 'browser' | 'host' | 'worker' | 'edge';

// @kern-source: import-metadata:4
export type CapabilityEffect = 'network' | 'fs' | 'exec' | 'secret' | 'stream' | 'state' | 'auth' | 'cpu' | 'validation' | 'io';

// @kern-source: import-metadata:5
export type CapabilitySerialization = 'json' | 'ndjson' | 'stream' | 'handle' | 'none';

// @kern-source: import-metadata:6
export type ExternalImportTargetFamily = 'all' | 'ts' | 'python' | 'none';

// @kern-source: import-metadata:7
export type ImportMetadataProps = { registry?: unknown; target?: unknown };

// @kern-source: import-metadata:8
export type MetadataNode = { type: string; props?: Record<string, unknown> };

// @kern-source: import-metadata:10
export const VALID_IMPORT_REGISTRIES = ['host', 'npm', 'pypi', 'kern'];

// @kern-source: import-metadata:11
export const VALID_IMPORT_TARGETS = ['all', 'ts', 'python', 'react', 'node', 'express', 'cli', 'lib', 'mcp', 'terminal', 'ink', 'vue', 'nuxt', 'nextjs', 'native', 'web', 'fastapi'];

// @kern-source: import-metadata:12
export const TS_FAMILY_TARGETS = ['ts', 'react', 'node', 'express', 'cli', 'lib', 'mcp', 'terminal', 'ink', 'vue', 'nuxt', 'nextjs', 'native', 'web'];

// @kern-source: import-metadata:13
export const PYTHON_FAMILY_TARGETS = ['python', 'fastapi'];

// @kern-source: import-metadata:14
export const VALID_CAPABILITY_RUNTIMES = ['node', 'python', 'browser', 'host', 'worker', 'edge'];

// @kern-source: import-metadata:15
export const VALID_CAPABILITY_EFFECTS = ['network', 'fs', 'exec', 'secret', 'stream', 'state', 'auth', 'cpu', 'validation', 'io'];

// @kern-source: import-metadata:16
export const VALID_CAPABILITY_SERIALIZATIONS = ['json', 'ndjson', 'stream', 'handle', 'none'];

// @kern-source: import-metadata:17
export const VALID_CAPABILITY_PROTOCOLS = ['pty-session', 'ptysession', 'session'];

// @kern-source: import-metadata:19
export function splitCapabilityList(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  const trimmed = value.trim();
  const unwrapped = (trimmed.startsWith('[') && trimmed.endsWith(']')) ? trimmed.slice(1, -1).trim() : trimmed;
  if (unwrapped === '') {
    return [];
  }
  return unwrapped.split(',').map((part) => part.trim().replace(new RegExp('^["\\x27]|["\\x27]$', 'gu'), '')).filter(Boolean);
}

// @kern-source: import-metadata:29
export function importRegistryOf(raw: unknown): ExternalImportRegistry {
  if (raw === undefined || raw === null || raw === '') {
    return 'host';
  }
  const value = String(raw).toLowerCase();
  return VALID_IMPORT_REGISTRIES.includes(value) ? (value as ExternalImportRegistry) : 'host';
}

// @kern-source: import-metadata:36
export function importTargetOf(rawTarget: unknown, rawRegistry: unknown): ExternalImportTarget {
  if (rawTarget !== undefined && rawTarget !== null && rawTarget !== '') {
    const value = String(rawTarget).toLowerCase();
    return VALID_IMPORT_TARGETS.includes(value) ? (value as ExternalImportTarget) : 'all';
  }
  const registry = importRegistryOf(rawRegistry);
  if (registry === 'npm') {
    return 'ts';
  }
  if (registry === 'pypi') {
    return 'python';
  }
  return 'all';
}

// @kern-source: import-metadata:50
export function importTargetFamilyOf(rawTarget: unknown, rawRegistry: unknown): ExternalImportTargetFamily {
  if (rawTarget !== undefined && rawTarget !== null && rawTarget !== '') {
    const value = String(rawTarget).toLowerCase();
    if (!VALID_IMPORT_TARGETS.includes(value)) {
      return 'none';
    }
  }
  const target = importTargetOf(rawTarget, rawRegistry);
  if (target === 'all') {
    return 'all';
  }
  if (PYTHON_FAMILY_TARGETS.includes(target)) {
    return 'python';
  }
  return TS_FAMILY_TARGETS.includes(target) ? 'ts' : 'none';
}

// @kern-source: import-metadata:65
export function shouldEmitImportForTarget(props: ImportMetadataProps, target: Exclude<ExternalImportTarget, 'all'>): boolean {
  const declaredTarget = importTargetFamilyOf(props.target, props.registry);
  if (declaredTarget === 'none') {
    return true;
  }
  const outputFamily = importTargetFamilyOf(target, undefined);
  return declaredTarget === 'all' || declaredTarget === outputFamily;
}

// @kern-source: import-metadata:75
export function validateImportMetadata(node: MetadataNode): string[] {
  const props = node.props ?? {};
  const nodeLabel = node.type === 'extern' ? 'extern' : 'import';
  const violations: string[] = [];
  const rawRegistry = props.registry;
  const rawTarget = props.target;
  const registry =
    rawRegistry === undefined || rawRegistry === null || rawRegistry === '' ? 'host' : String(rawRegistry);
  const target = rawTarget === undefined || rawTarget === null || rawTarget === '' ? '' : String(rawTarget);
  
  if (registry && !VALID_IMPORT_REGISTRIES.includes(registry.toLowerCase())) {
    violations.push(`'${nodeLabel} registry=' must be one of host, npm, pypi, kern`);
  }
  if (target && !VALID_IMPORT_TARGETS.includes(target.toLowerCase())) {
    violations.push(
      `'${nodeLabel} target=' must be one of all, ts, python, react, node, express, cli, lib, mcp, terminal, ink, vue, nuxt, nextjs, native, web, fastapi`,
    );
  }
  
  const normalizedRegistry = importRegistryOf(rawRegistry);
  const normalizedTarget = importTargetFamilyOf(rawTarget, rawRegistry);
  if (normalizedRegistry === 'npm' && normalizedTarget !== 'ts') {
    violations.push(`'${nodeLabel} registry=npm' must target a TS-family target or omit target= so KERN can infer ts`);
  }
  if (normalizedRegistry === 'pypi' && normalizedTarget !== 'python') {
    violations.push(`'${nodeLabel} registry=pypi' must target python/fastapi or omit target= so KERN can infer python`);
  }
  
  return violations;
}

// @kern-source: import-metadata:107
export function validateCapabilityMetadata(node: MetadataNode): string[] {
  const props = node.props ?? {};
  const label = node.type;
  const violations: string[] = [];
  
  if (props.runtime !== undefined && props.runtime !== null && props.runtime !== '') {
    const runtime = String(props.runtime).toLowerCase();
    if (!VALID_CAPABILITY_RUNTIMES.includes(runtime)) {
      violations.push(`'${label} runtime=' must be one of node, python, browser, host, worker, edge`);
    }
  }
  
  for (const effect of splitCapabilityList(props.effects)) {
    const normalized = effect.toLowerCase();
    if (!VALID_CAPABILITY_EFFECTS.includes(normalized)) {
      violations.push(
        `'${label} effects=' contains unsupported effect '${effect}' (expected network, fs, exec, secret, stream, state, auth, cpu, validation, io)`,
      );
    }
  }
  
  if (props.serialization !== undefined && props.serialization !== null && props.serialization !== '') {
    const serialization = String(props.serialization).toLowerCase();
    if (!VALID_CAPABILITY_SERIALIZATIONS.includes(serialization)) {
      violations.push(`'${label} serialization=' must be one of json, ndjson, stream, handle, none`);
    }
  }
  
  if (props.protocol !== undefined && props.protocol !== null && props.protocol !== '') {
    const protocol = String(props.protocol).toLowerCase();
    if (!VALID_CAPABILITY_PROTOCOLS.includes(protocol)) {
      violations.push(`'${label} protocol=' must be one of pty-session`);
    }
  }
  
  return violations;
}

