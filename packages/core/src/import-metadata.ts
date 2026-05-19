import type { IRNode } from './types.js';

export type ExternalImportRegistry = 'host' | 'npm' | 'pypi' | 'kern';
export type ExternalImportTarget =
  | 'all'
  | 'ts'
  | 'python'
  | 'react'
  | 'node'
  | 'express'
  | 'cli'
  | 'lib'
  | 'mcp'
  | 'terminal'
  | 'ink'
  | 'vue'
  | 'nuxt'
  | 'nextjs'
  | 'native'
  | 'web'
  | 'fastapi';
export type CapabilityRuntime = 'node' | 'python' | 'browser' | 'host' | 'worker' | 'edge';
export type CapabilityEffect =
  | 'network'
  | 'fs'
  | 'exec'
  | 'secret'
  | 'stream'
  | 'state'
  | 'auth'
  | 'cpu'
  | 'validation'
  | 'io';
export type CapabilitySerialization = 'json' | 'ndjson' | 'stream' | 'handle' | 'none';

const VALID_IMPORT_REGISTRIES = new Set(['host', 'npm', 'pypi', 'kern']);
const VALID_IMPORT_TARGETS = new Set([
  'all',
  'ts',
  'python',
  'react',
  'node',
  'express',
  'cli',
  'lib',
  'mcp',
  'terminal',
  'ink',
  'vue',
  'nuxt',
  'nextjs',
  'native',
  'web',
  'fastapi',
]);
const TS_FAMILY_TARGETS = new Set([
  'ts',
  'react',
  'node',
  'express',
  'cli',
  'lib',
  'mcp',
  'terminal',
  'ink',
  'vue',
  'nuxt',
  'nextjs',
  'native',
  'web',
]);
const PYTHON_FAMILY_TARGETS = new Set(['python', 'fastapi']);
const VALID_CAPABILITY_RUNTIMES = new Set(['node', 'python', 'browser', 'host', 'worker', 'edge']);
const VALID_CAPABILITY_EFFECTS = new Set([
  'network',
  'fs',
  'exec',
  'secret',
  'stream',
  'state',
  'auth',
  'cpu',
  'validation',
  'io',
]);
const VALID_CAPABILITY_SERIALIZATIONS = new Set(['json', 'ndjson', 'stream', 'handle', 'none']);
const VALID_CAPABILITY_PROTOCOLS = new Set(['pty-session', 'ptysession', 'session']);

export function splitCapabilityList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1).trim() : trimmed;
  if (unwrapped === '') return [];
  return unwrapped
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/gu, ''))
    .filter(Boolean);
}

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

export function importTargetFamilyOf(rawTarget: unknown, rawRegistry: unknown): 'all' | 'ts' | 'python' | 'none' {
  if (rawTarget !== undefined && rawTarget !== null && rawTarget !== '') {
    const value = String(rawTarget).toLowerCase();
    if (!VALID_IMPORT_TARGETS.has(value)) return 'none';
  }
  const target = importTargetOf(rawTarget, rawRegistry);
  if (target === 'all') return 'all';
  if (PYTHON_FAMILY_TARGETS.has(target)) return 'python';
  return TS_FAMILY_TARGETS.has(target) ? 'ts' : 'none';
}

export function shouldEmitImportForTarget(
  props: { registry?: unknown; target?: unknown },
  target: Exclude<ExternalImportTarget, 'all'>,
): boolean {
  const declaredTarget = importTargetFamilyOf(props.target, props.registry);
  if (declaredTarget === 'none') return true;
  const outputFamily = importTargetFamilyOf(target, undefined);
  return declaredTarget === 'all' || declaredTarget === outputFamily;
}

export function validateImportMetadata(node: IRNode): string[] {
  const props = node.props ?? {};
  const nodeLabel = node.type === 'extern' ? 'extern' : 'import';
  const violations: string[] = [];
  const rawRegistry = props.registry;
  const rawTarget = props.target;
  const registry =
    rawRegistry === undefined || rawRegistry === null || rawRegistry === '' ? 'host' : String(rawRegistry);
  const target = rawTarget === undefined || rawTarget === null || rawTarget === '' ? '' : String(rawTarget);

  if (registry && !VALID_IMPORT_REGISTRIES.has(registry.toLowerCase())) {
    violations.push(`'${nodeLabel} registry=' must be one of host, npm, pypi, kern`);
  }
  if (target && !VALID_IMPORT_TARGETS.has(target.toLowerCase())) {
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

export function validateCapabilityMetadata(node: IRNode): string[] {
  const props = node.props ?? {};
  const label = node.type;
  const violations: string[] = [];

  if (props.runtime !== undefined && props.runtime !== null && props.runtime !== '') {
    const runtime = String(props.runtime).toLowerCase();
    if (!VALID_CAPABILITY_RUNTIMES.has(runtime)) {
      violations.push(`'${label} runtime=' must be one of node, python, browser, host, worker, edge`);
    }
  }

  for (const effect of splitCapabilityList(props.effects)) {
    const normalized = effect.toLowerCase();
    if (!VALID_CAPABILITY_EFFECTS.has(normalized)) {
      violations.push(
        `'${label} effects=' contains unsupported effect '${effect}' (expected network, fs, exec, secret, stream, state, auth, cpu, validation, io)`,
      );
    }
  }

  if (props.serialization !== undefined && props.serialization !== null && props.serialization !== '') {
    const serialization = String(props.serialization).toLowerCase();
    if (!VALID_CAPABILITY_SERIALIZATIONS.has(serialization)) {
      violations.push(`'${label} serialization=' must be one of json, ndjson, stream, handle, none`);
    }
  }

  if (props.protocol !== undefined && props.protocol !== null && props.protocol !== '') {
    const protocol = String(props.protocol).toLowerCase();
    if (!VALID_CAPABILITY_PROTOCOLS.has(protocol)) {
      violations.push(`'${label} protocol=' must be one of pty-session`);
    }
  }

  return violations;
}
