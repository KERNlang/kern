// @kern-source: external-boundary-utils:1
import { splitCapabilityList } from './import-metadata.js';
import type { ExternalImportRegistry, ExternalImportTarget, ExternalImportTargetFamily } from './import-metadata.js';

// @kern-source: external-boundary-utils:7
export type ExternalBoundaryStringKey = 'runtime' | 'serialization' | 'version' | 'review' | 'reason' | 'protocol' | 'module' | 'session' | 'options' | 'error' | 'timeout';

// @kern-source: external-boundary-utils:8
export type ExternalBoundaryInheritance = { runtime?: string; serialization?: string; version?: string; review?: string; reason?: string; protocol?: string; module?: string; session?: string; options?: string; error?: string; timeout?: string; effects?: string[]; args?: string[] };

// @kern-source: external-boundary-utils:9
export type ExternalRuntimeImportShape = { names: string[]; default?: string; from?: string; signature?: string; signatures?: Record<string, string>; types: boolean; line?: number; col?: number };

// @kern-source: external-boundary-utils:10
export type ExternalBoundaryRuntimeShape = { explicitPackage?: boolean; island?: unknown; imports: ExternalRuntimeImportShape[]; requiresSidecar?: boolean; targetFamily?: string; registry?: string };

// @kern-source: external-boundary-utils:11
export type ExternalSidecarBoundaryShape = ExternalBoundaryRuntimeShape & { package: string; registry: ExternalImportRegistry; target: ExternalImportTarget; targetFamily: ExternalImportTargetFamily; version?: string; line?: number; col?: number };

// @kern-source: external-boundary-utils:12
export type ExternalSidecarPackageShape = { package: string; registry: ExternalImportRegistry; target: ExternalImportTarget; targetFamily: ExternalImportTargetFamily; imports: ExternalRuntimeImportShape[]; version?: string; line?: number; col?: number };

// @kern-source: external-boundary-utils:14
export function splitExternalNames(value: unknown): string[] {
  return splitCapabilityList(value);
}

// @kern-source: external-boundary-utils:18
export function externalStringProp(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  return (typeof value === 'string' && value.length > 0) ? value : undefined;
}

// @kern-source: external-boundary-utils:25
export function externalBoolProp(props: Record<string, unknown>, key: string): boolean {
  return props[key] === true || props[key] === 'true';
}

// @kern-source: external-boundary-utils:31
export function mergeExternalEffects(props: Record<string, unknown>, island: ExternalBoundaryInheritance | undefined): string[] {
  const islandEffects = Array.isArray(island?.effects) ? island.effects : [];
  return [...new Set([...islandEffects, ...splitExternalNames(props.effects)])];
}

// @kern-source: external-boundary-utils:38
export function inheritExternalString(props: Record<string, unknown>, key: ExternalBoundaryStringKey, island: ExternalBoundaryInheritance | undefined): string | undefined {
  const value = externalStringProp(props, key);
  if (value !== undefined) {
    return value;
  }
  const inherited = island?.[key];
  return (typeof inherited === 'string') ? inherited : undefined;
}

// @kern-source: external-boundary-utils:49
export function inheritExternalArgs(props: Record<string, unknown>, island: ExternalBoundaryInheritance | undefined): string[] | undefined {
  const args = splitExternalNames(props.args);
  return (args.length > 0) ? args : island?.args;
}

// @kern-source: external-boundary-utils:56
export function hasExternalRuntimeImports(boundary: ExternalBoundaryRuntimeShape): boolean {
  return boundary.imports.some((binding) => binding.types !== true);
}

// @kern-source: external-boundary-utils:61
export function externalRuntimeImports(imports: ExternalRuntimeImportShape[]): ExternalRuntimeImportShape[] {
  return imports.filter((binding) => binding.types !== true);
}

// @kern-source: external-boundary-utils:66
export function isPythonSidecarBoundaryShape(boundary: ExternalBoundaryRuntimeShape): boolean {
  return boundary.requiresSidecar === true && hasExternalRuntimeImports(boundary) && (boundary.targetFamily === 'python' || boundary.registry === 'pypi');
}

// @kern-source: external-boundary-utils:71
export function isLoosePythonBoundaryShape(boundary: ExternalBoundaryRuntimeShape): boolean {
  return boundary.explicitPackage === true && !boundary.island && hasExternalRuntimeImports(boundary) && (boundary.targetFamily === 'python' || boundary.registry === 'pypi');
}

// @kern-source: external-boundary-utils:76
export function externalSidecarPackageKey(sidecarPackage: ExternalSidecarPackageShape): string {
  return `${sidecarPackage.package}\x00${sidecarPackage.registry}\x00${sidecarPackage.target}`;
}

// @kern-source: external-boundary-utils:81
export function externalSidecarPackageFromBoundary(boundary: ExternalSidecarBoundaryShape): ExternalSidecarPackageShape {
  const sidecarPackage: ExternalSidecarPackageShape = {
    package: boundary.package,
    registry: boundary.registry,
    target: boundary.target,
    targetFamily: boundary.targetFamily,
    imports: externalRuntimeImports(boundary.imports),
  };
  if (boundary.version !== undefined) sidecarPackage.version = boundary.version;
  if (boundary.line !== undefined) sidecarPackage.line = boundary.line;
  if (boundary.col !== undefined) sidecarPackage.col = boundary.col;
  return sidecarPackage;
}

