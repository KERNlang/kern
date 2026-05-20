// @kern-source: external-boundary-utils:1
import { splitCapabilityList } from './import-metadata.js';
import type { ExternalImportRegistry, ExternalImportTarget, ExternalImportTargetFamily } from './import-metadata.js';

// @kern-source: external-boundary-utils:6
import { parseExternalSignatureMap } from './ecosystem-signatures.js';
import type { ExternalSignatureMap } from './ecosystem-signatures.js';

// @kern-source: external-boundary-utils:9
import { pythonSidecarNameFromAliasAndPackage } from './python-sidecar.js';

// @kern-source: external-boundary-utils:12
export type ExternalBoundaryStringKey = 'runtime' | 'serialization' | 'version' | 'review' | 'reason' | 'protocol' | 'module' | 'session' | 'options' | 'error' | 'timeout';

// @kern-source: external-boundary-utils:13
export type ExternalBoundaryInheritance = { runtime?: string; serialization?: string; version?: string; review?: string; reason?: string; protocol?: string; module?: string; session?: string; options?: string; error?: string; timeout?: string; effects?: string[]; args?: string[] };

// @kern-source: external-boundary-utils:14
export type ExternalBoundaryIslandShape = { name: string; kind?: string; runtime?: string; serialization?: string; version?: string; review?: string; reason?: string; protocol?: string; module?: string; session?: string; options?: string; error?: string; timeout?: string; effects: string[]; args?: string[]; requiresSidecar: boolean; line?: number; col?: number };

// @kern-source: external-boundary-utils:15
export type ExternalRuntimeImportShape = { names: string[]; default?: string; from?: string; signature?: string; signatures?: ExternalSignatureMap; types: boolean; line?: number; col?: number };

// @kern-source: external-boundary-utils:16
export type ExternalBoundaryRuntimeShape = { explicitPackage?: boolean; island?: unknown; imports: ExternalRuntimeImportShape[]; requiresSidecar?: boolean; targetFamily?: string; registry?: string };

// @kern-source: external-boundary-utils:17
export type ExternalLoosePythonSidecarNameShape = ExternalBoundaryRuntimeShape & { package: string };

// @kern-source: external-boundary-utils:18
export type ExternalSidecarBoundaryShape = ExternalBoundaryRuntimeShape & { package: string; registry: ExternalImportRegistry; target: ExternalImportTarget; targetFamily: ExternalImportTargetFamily; effects?: string[]; serialization?: string; version?: string; line?: number; col?: number };

// @kern-source: external-boundary-utils:19
export type ExternalBoundaryShape = { package: string; explicitPackage?: boolean; registry: ExternalImportRegistry; target: ExternalImportTarget; targetFamily: ExternalImportTargetFamily; island?: ExternalBoundaryIslandShape; runtime?: string; protocol?: string; module?: string; args?: string[]; session?: string; options?: string; error?: string; timeout?: string; effects: string[]; serialization?: string; requiresSidecar?: boolean; version?: string; review?: string; reason?: string; imports: ExternalRuntimeImportShape[]; line?: number; col?: number };

// @kern-source: external-boundary-utils:20
export type ExternalCapabilityIslandShape = ExternalBoundaryIslandShape & { imports: ExternalBoundaryShape[] };

// @kern-source: external-boundary-utils:21
export type ExternalSidecarPackageShape = { package: string; registry: ExternalImportRegistry; target: ExternalImportTarget; targetFamily: ExternalImportTargetFamily; imports: ExternalRuntimeImportShape[]; version?: string; line?: number; col?: number };

// @kern-source: external-boundary-utils:22
export type ExternalSidecarIslandShape = { name: string; kind?: string; runtime?: string; protocol?: string; module?: string; args?: string[]; session?: string; options?: string; error?: string; timeout?: string; effects: string[]; serialization?: string; requiresSidecar: boolean; imports: ExternalSidecarBoundaryShape[]; line?: number; col?: number };

// @kern-source: external-boundary-utils:23
export type ExternalSidecarManifestShape = { name: string; kind?: string; runtime: string; protocol?: string; module?: string; args?: string[]; session?: string; options?: string; error?: string; timeout?: string; effects: string[]; serialization?: string; requiresSidecar: true; packages: ExternalSidecarPackageShape[]; line?: number; col?: number };

// @kern-source: external-boundary-utils:25
export function splitExternalNames(value: unknown): string[] {
  return splitCapabilityList(value);
}

// @kern-source: external-boundary-utils:29
export function externalStringProp(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  return (typeof value === 'string' && value.length > 0) ? value : undefined;
}

// @kern-source: external-boundary-utils:36
export function externalBoolProp(props: Record<string, unknown>, key: string): boolean {
  return props[key] === true || props[key] === 'true';
}

// @kern-source: external-boundary-utils:42
export function mergeExternalEffects(props: Record<string, unknown>, island: ExternalBoundaryInheritance | undefined): string[] {
  const islandEffects = Array.isArray(island?.effects) ? island.effects : [];
  return [...new Set([...islandEffects, ...splitExternalNames(props.effects)])];
}

// @kern-source: external-boundary-utils:49
export function inheritExternalString(props: Record<string, unknown>, key: ExternalBoundaryStringKey, island: ExternalBoundaryInheritance | undefined): string | undefined {
  const value = externalStringProp(props, key);
  if (value !== undefined) {
    return value;
  }
  const inherited = island?.[key];
  return (typeof inherited === 'string') ? inherited : undefined;
}

// @kern-source: external-boundary-utils:60
export function inheritExternalArgs(props: Record<string, unknown>, island: ExternalBoundaryInheritance | undefined): string[] | undefined {
  const args = splitExternalNames(props.args);
  return (args.length > 0) ? args : island?.args;
}

// @kern-source: external-boundary-utils:67
export function externalIslandRefFromParts(props: Record<string, unknown>, line: number | undefined, col: number | undefined): ExternalBoundaryIslandShape | null {
  const name = externalStringProp(props, 'name');
  if (!name) return null;
  const args = splitExternalNames(props.args);
  const island: ExternalBoundaryIslandShape = {
    name,
    kind: externalStringProp(props, 'kind'),
    runtime: externalStringProp(props, 'runtime'),
    protocol: externalStringProp(props, 'protocol'),
    module: externalStringProp(props, 'module'),
    ...(args.length > 0 ? { args } : {}),
    session: externalStringProp(props, 'session'),
    options: externalStringProp(props, 'options'),
    error: externalStringProp(props, 'error'),
    timeout: externalStringProp(props, 'timeout'),
    effects: splitExternalNames(props.effects),
    serialization: externalStringProp(props, 'serialization'),
    requiresSidecar: externalBoolProp(props, 'requiresSidecar'),
    version: externalStringProp(props, 'version'),
    review: externalStringProp(props, 'review'),
    reason: externalStringProp(props, 'reason'),
    line,
    col,
  };
  return island;
}

// @kern-source: external-boundary-utils:98
export function externalImportBindingFromParts(props: Record<string, unknown>, line: number | undefined, col: number | undefined): ExternalRuntimeImportShape {
  const explicitSignatures = parseExternalSignatureMap(props.signatures);
  const binding: ExternalRuntimeImportShape = {
    names: splitExternalNames(props.names),
    default: typeof props.default === 'string' && props.default.length > 0 ? props.default : undefined,
    from: typeof props.from === 'string' && props.from.length > 0 ? props.from : undefined,
    signature: typeof props.signature === 'string' && props.signature.length > 0 ? props.signature : undefined,
    signatures: explicitSignatures,
    types: props.types === true || props.types === 'true',
    line,
    col,
  };
  if (!binding.signatures) delete binding.signatures;
  return binding;
}

// @kern-source: external-boundary-utils:118
export function externalPackageNameFromExternProps(props: Record<string, unknown>): string | null {
  const packageName = props.package;
  if (typeof packageName !== 'string' || packageName.length === 0) {
    return null;
  }
  return packageName;
}

// @kern-source: external-boundary-utils:126
export function externalPackageNameFromImportProps(props: Record<string, unknown>): string | null {
  if (typeof props.package === 'string' && props.package.length > 0) return props.package;
  if (typeof props.from === 'string' && props.from.length > 0) return props.from;
  return null;
}

// @kern-source: external-boundary-utils:134
export function hasExplicitExternalPackageProp(props: Record<string, unknown>): boolean {
  return typeof props.package === 'string' && props.package.length > 0;
}

// @kern-source: external-boundary-utils:139
export function externalBoundaryFromExternParts(props: Record<string, unknown>, registry: ExternalImportRegistry, target: ExternalImportTarget, targetFamily: ExternalImportTargetFamily, island: ExternalBoundaryIslandShape | undefined, imports: ExternalRuntimeImportShape[], line: number | undefined, col: number | undefined): ExternalBoundaryShape | null {
  const packageName = externalPackageNameFromExternProps(props);
  if (!packageName) return null;
  return externalBoundaryFromParts(packageName, registry, target, targetFamily, props, island, imports, line, col);
}

// @kern-source: external-boundary-utils:154
export function externalBoundaryFromImportParts(props: Record<string, unknown>, registry: ExternalImportRegistry, target: ExternalImportTarget, targetFamily: ExternalImportTargetFamily, island: ExternalBoundaryIslandShape | undefined, importBinding: ExternalRuntimeImportShape, line: number | undefined, col: number | undefined): ExternalBoundaryShape | null {
  const packageName = externalPackageNameFromImportProps(props);
  if (!packageName) return null;
  const boundary = externalBoundaryFromParts(packageName, registry, target, targetFamily, props, island, [importBinding], line, col);
  if (hasExplicitExternalPackageProp(props)) {
    Object.defineProperty(boundary, 'explicitPackage', {
      value: true,
      enumerable: false,
      configurable: true,
    });
  }
  return boundary;
}

// @kern-source: external-boundary-utils:177
export function externalCapabilityIslandFromParts(island: ExternalBoundaryIslandShape | null, imports: ExternalBoundaryShape[]): ExternalCapabilityIslandShape | null {
  if (!island) {
    return null;
  }
  return { ...island, imports: imports };
}

// @kern-source: external-boundary-utils:185
export function externalLoosePythonSidecarName(boundary: ExternalLoosePythonSidecarNameShape): string {
  const alias = boundary.imports.find((binding) => binding.default)?.default;
  return pythonSidecarNameFromAliasAndPackage(alias, boundary.package);
}

// @kern-source: external-boundary-utils:191
export function hasExternalRuntimeImports(boundary: ExternalBoundaryRuntimeShape): boolean {
  return boundary.imports.some((binding) => binding.types !== true);
}

// @kern-source: external-boundary-utils:196
export function externalRuntimeImports(imports: ExternalRuntimeImportShape[]): ExternalRuntimeImportShape[] {
  return imports.filter((binding) => binding.types !== true);
}

// @kern-source: external-boundary-utils:201
export function isPythonSidecarBoundaryShape(boundary: ExternalBoundaryRuntimeShape): boolean {
  return boundary.requiresSidecar === true && hasExternalRuntimeImports(boundary) && (boundary.targetFamily === 'python' || boundary.registry === 'pypi');
}

// @kern-source: external-boundary-utils:206
export function isLoosePythonBoundaryShape(boundary: ExternalBoundaryRuntimeShape): boolean {
  return boundary.explicitPackage === true && !boundary.island && hasExternalRuntimeImports(boundary) && (boundary.targetFamily === 'python' || boundary.registry === 'pypi');
}

// @kern-source: external-boundary-utils:211
export function externalSidecarPackageKey(sidecarPackage: ExternalSidecarPackageShape): string {
  return `${sidecarPackage.package}\x00${sidecarPackage.registry}\x00${sidecarPackage.target}`;
}

// @kern-source: external-boundary-utils:216
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

// @kern-source: external-boundary-utils:232
export function externalBoundaryFromParts(packageName: string, registry: ExternalImportRegistry, target: ExternalImportTarget, targetFamily: ExternalImportTargetFamily, props: Record<string, unknown>, island: ExternalBoundaryIslandShape | undefined, imports: ExternalRuntimeImportShape[], line: number | undefined, col: number | undefined): ExternalBoundaryShape {
  const boundary: ExternalBoundaryShape = {
    package: packageName,
    registry,
    target,
    targetFamily,
    island,
    runtime: inheritExternalString(props, 'runtime', island),
    protocol: inheritExternalString(props, 'protocol', island),
    module: inheritExternalString(props, 'module', island),
    args: inheritExternalArgs(props, island),
    session: inheritExternalString(props, 'session', island),
    options: inheritExternalString(props, 'options', island),
    error: inheritExternalString(props, 'error', island),
    timeout: inheritExternalString(props, 'timeout', island),
    effects: mergeExternalEffects(props, island),
    serialization: inheritExternalString(props, 'serialization', island),
    requiresSidecar: externalBoolProp(props, 'requiresSidecar') || island?.requiresSidecar === true,
    version: inheritExternalString(props, 'version', island),
    review: inheritExternalString(props, 'review', island),
    reason: inheritExternalString(props, 'reason', island),
    imports,
    line,
    col,
  };
  return boundary;
}

// @kern-source: external-boundary-utils:270
export function externalSidecarManifestFromIsland(island: ExternalSidecarIslandShape): ExternalSidecarManifestShape | null {
  if (island.requiresSidecar !== true || island.runtime !== 'python') return null;
  const packages = island.imports
    .filter(isPythonSidecarBoundaryShape)
    .map(externalSidecarPackageFromBoundary);
  const protocol = island.protocol;
  if (packages.length === 0 && !protocol) return null;
  const manifest: ExternalSidecarManifestShape = {
    name: island.name,
    runtime: island.runtime,
    effects: island.effects,
    requiresSidecar: true,
    packages,
  };
  if (island.kind !== undefined) manifest.kind = island.kind;
  if (protocol !== undefined) manifest.protocol = protocol;
  if (island.module !== undefined) manifest.module = island.module;
  if (island.args !== undefined && island.args.length > 0) manifest.args = island.args;
  if (island.session !== undefined) manifest.session = island.session;
  if (island.options !== undefined) manifest.options = island.options;
  if (island.error !== undefined) manifest.error = island.error;
  if (island.timeout !== undefined) manifest.timeout = island.timeout;
  if (island.serialization !== undefined) manifest.serialization = island.serialization;
  if (island.line !== undefined) manifest.line = island.line;
  if (island.col !== undefined) manifest.col = island.col;
  return manifest;
}

// @kern-source: external-boundary-utils:300
export function externalLooseSidecarManifestFromBoundary(name: string, boundary: ExternalSidecarBoundaryShape, sidecarPackage: ExternalSidecarPackageShape): ExternalSidecarManifestShape {
  const manifest: ExternalSidecarManifestShape = {
    name,
    kind: 'sidecar',
    runtime: 'python',
    effects: boundary.effects ?? [],
    serialization: boundary.serialization ?? 'json',
    requiresSidecar: true,
    packages: [sidecarPackage],
  };
  if (boundary.line !== undefined) manifest.line = boundary.line;
  if (boundary.col !== undefined) manifest.col = boundary.col;
  return manifest;
}

// @kern-source: external-boundary-utils:319
export function mergeExternalSidecarManifestPackage(manifest: ExternalSidecarManifestShape, sidecarPackage: ExternalSidecarPackageShape, effects: string[] | undefined): ExternalSidecarManifestShape {
  manifest.effects = [...new Set([...manifest.effects, ...(effects ?? [])])];
  const packageKey = externalSidecarPackageKey(sidecarPackage);
  const existingPackage = manifest.packages.find(
    (pkg) => externalSidecarPackageKey(pkg) === packageKey,
  );
  if (existingPackage) {
    existingPackage.imports.push(...sidecarPackage.imports);
    if (!existingPackage.version && sidecarPackage.version) existingPackage.version = sidecarPackage.version;
  } else {
    manifest.packages.push(sidecarPackage);
  }
  return manifest;
}

