// @kern-source: external-boundary-utils:1
import { splitCapabilityList } from './import-metadata.js';

// @kern-source: external-boundary-utils:4
export type ExternalBoundaryStringKey = 'runtime' | 'serialization' | 'version' | 'review' | 'reason' | 'protocol' | 'module' | 'session' | 'options' | 'error' | 'timeout';

// @kern-source: external-boundary-utils:5
export type ExternalBoundaryInheritance = { runtime?: string; serialization?: string; version?: string; review?: string; reason?: string; protocol?: string; module?: string; session?: string; options?: string; error?: string; timeout?: string; effects?: string[]; args?: string[] };

// @kern-source: external-boundary-utils:6
export type ExternalBoundaryRuntimeShape = { explicitPackage?: boolean; island?: unknown; imports: Array<{ types?: boolean }>; requiresSidecar?: boolean; targetFamily?: string; registry?: string };

// @kern-source: external-boundary-utils:8
export function splitExternalNames(value: unknown): string[] {
  return splitCapabilityList(value);
}

// @kern-source: external-boundary-utils:12
export function externalStringProp(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  return (typeof value === 'string' && value.length > 0) ? value : undefined;
}

// @kern-source: external-boundary-utils:19
export function externalBoolProp(props: Record<string, unknown>, key: string): boolean {
  return props[key] === true || props[key] === 'true';
}

// @kern-source: external-boundary-utils:25
export function mergeExternalEffects(props: Record<string, unknown>, island: ExternalBoundaryInheritance | undefined): string[] {
  const islandEffects = Array.isArray(island?.effects) ? island.effects : [];
  return [...new Set([...islandEffects, ...splitExternalNames(props.effects)])];
}

// @kern-source: external-boundary-utils:32
export function inheritExternalString(props: Record<string, unknown>, key: ExternalBoundaryStringKey, island: ExternalBoundaryInheritance | undefined): string | undefined {
  const value = externalStringProp(props, key);
  if (value !== undefined) {
    return value;
  }
  const inherited = island?.[key];
  return (typeof inherited === 'string') ? inherited : undefined;
}

// @kern-source: external-boundary-utils:43
export function inheritExternalArgs(props: Record<string, unknown>, island: ExternalBoundaryInheritance | undefined): string[] | undefined {
  const args = splitExternalNames(props.args);
  return (args.length > 0) ? args : island?.args;
}

// @kern-source: external-boundary-utils:50
export function hasExternalRuntimeImports(boundary: ExternalBoundaryRuntimeShape): boolean {
  return boundary.imports.some((binding) => binding.types !== true);
}

// @kern-source: external-boundary-utils:55
export function isPythonSidecarBoundaryShape(boundary: ExternalBoundaryRuntimeShape): boolean {
  return boundary.requiresSidecar === true && hasExternalRuntimeImports(boundary) && (boundary.targetFamily === 'python' || boundary.registry === 'pypi');
}

// @kern-source: external-boundary-utils:60
export function isLoosePythonBoundaryShape(boundary: ExternalBoundaryRuntimeShape): boolean {
  return boundary.explicitPackage === true && !boundary.island && hasExternalRuntimeImports(boundary) && (boundary.targetFamily === 'python' || boundary.registry === 'pypi');
}

