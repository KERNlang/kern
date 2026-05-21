import { type ExternalSignatureMap, parseExternalSignatureMap } from './ecosystem-signatures.js';
import {
  type ExternalImportRegistry,
  type ExternalImportTarget,
  importRegistryOf,
  importTargetFamilyOf,
  importTargetOf,
} from './import-metadata.js';
import {
  externalBoolProp,
  externalSidecarPackageFromBoundary,
  externalSidecarPackageKey,
  externalStringProp,
  hasExternalRuntimeImports,
  inheritExternalArgs,
  inheritExternalString,
  isLoosePythonBoundaryShape,
  isPythonSidecarBoundaryShape,
  mergeExternalEffects,
  splitExternalNames,
} from './external-boundary-utils.js';
import { pythonSidecarNameFromAliasAndPackage } from './python-sidecar.js';
import type { IRNode } from './types.js';

export interface ExternalImportBinding {
  names: string[];
  default?: string;
  from?: string;
  signature?: string;
  signatures?: ExternalSignatureMap;
  types: boolean;
  line?: number;
  col?: number;
}

export interface ExternalBoundary {
  package: string;
  explicitPackage?: boolean;
  registry: ExternalImportRegistry;
  target: ExternalImportTarget;
  targetFamily: 'all' | 'ts' | 'python' | 'none';
  island?: CapabilityIslandRef;
  runtime?: string;
  protocol?: string;
  module?: string;
  args?: string[];
  session?: string;
  options?: string;
  error?: string;
  timeout?: string;
  effects: string[];
  serialization?: string;
  requiresSidecar?: boolean;
  version?: string;
  review?: string;
  reason?: string;
  imports: ExternalImportBinding[];
  line?: number;
  col?: number;
}

export interface CapabilityIslandRef {
  name: string;
  kind?: string;
  runtime?: string;
  protocol?: string;
  module?: string;
  args?: string[];
  session?: string;
  options?: string;
  error?: string;
  timeout?: string;
  effects: string[];
  serialization?: string;
  requiresSidecar: boolean;
  version?: string;
  review?: string;
  reason?: string;
  line?: number;
  col?: number;
}

export interface CapabilityIsland {
  name: string;
  kind?: string;
  runtime?: string;
  protocol?: string;
  module?: string;
  args?: string[];
  session?: string;
  options?: string;
  error?: string;
  timeout?: string;
  effects: string[];
  serialization?: string;
  requiresSidecar: boolean;
  version?: string;
  review?: string;
  reason?: string;
  imports: ExternalBoundary[];
  line?: number;
  col?: number;
}

export interface SidecarPackage {
  package: string;
  registry: ExternalImportRegistry;
  target: ExternalImportTarget;
  targetFamily: 'all' | 'ts' | 'python' | 'none';
  imports: ExternalImportBinding[];
  version?: string;
  line?: number;
  col?: number;
}

export interface SidecarManifest {
  name: string;
  kind?: string;
  runtime: string;
  protocol?: string;
  module?: string;
  args?: string[];
  session?: string;
  options?: string;
  error?: string;
  timeout?: string;
  effects: string[];
  serialization?: string;
  requiresSidecar: true;
  packages: SidecarPackage[];
  line?: number;
  col?: number;
}

function splitNames(value: unknown): string[] {
  return splitExternalNames(value);
}

function stringProp(props: Record<string, unknown>, key: string): string | undefined {
  return externalStringProp(props, key);
}

function boolProp(props: Record<string, unknown>, key: string): boolean {
  return externalBoolProp(props, key);
}

function mergeEffects(props: Record<string, unknown>, island?: CapabilityIslandRef): string[] {
  return mergeExternalEffects(props, island);
}

function inheritString(
  props: Record<string, unknown>,
  key:
    | 'runtime'
    | 'serialization'
    | 'version'
    | 'review'
    | 'reason'
    | 'protocol'
    | 'module'
    | 'session'
    | 'options'
    | 'error'
    | 'timeout',
  island?: CapabilityIslandRef,
): string | undefined {
  return inheritExternalString(props, key, island);
}

function inheritArgs(props: Record<string, unknown>, island?: CapabilityIslandRef): string[] | undefined {
  return inheritExternalArgs(props, island);
}

function islandRefFromNode(node: IRNode): CapabilityIslandRef | null {
  const props = node.props ?? {};
  const name = stringProp(props, 'name');
  if (!name) return null;
  const args = splitNames(props.args);

  return {
    name,
    kind: stringProp(props, 'kind'),
    runtime: stringProp(props, 'runtime'),
    protocol: stringProp(props, 'protocol'),
    module: stringProp(props, 'module'),
    ...(args.length > 0 ? { args } : {}),
    session: stringProp(props, 'session'),
    options: stringProp(props, 'options'),
    error: stringProp(props, 'error'),
    timeout: stringProp(props, 'timeout'),
    effects: splitNames(props.effects),
    serialization: stringProp(props, 'serialization'),
    requiresSidecar: boolProp(props, 'requiresSidecar'),
    version: stringProp(props, 'version'),
    review: stringProp(props, 'review'),
    reason: stringProp(props, 'reason'),
    line: node.loc?.line,
    col: node.loc?.col,
  };
}

function importBindingFromProps(props: Record<string, unknown>, loc?: IRNode['loc']): ExternalImportBinding {
  const explicitSignatures = parseExternalSignatureMap(props.signatures);
  const binding: ExternalImportBinding = {
    names: splitNames(props.names),
    default: typeof props.default === 'string' && props.default.length > 0 ? props.default : undefined,
    from: typeof props.from === 'string' && props.from.length > 0 ? props.from : undefined,
    signature: typeof props.signature === 'string' && props.signature.length > 0 ? props.signature : undefined,
    signatures: explicitSignatures,
    types: props.types === true || props.types === 'true',
    line: loc?.line,
    col: loc?.col,
  };
  if (!binding.signatures) delete binding.signatures;
  return binding;
}

function boundaryFromExtern(node: IRNode, island?: CapabilityIslandRef): ExternalBoundary | null {
  const props = node.props ?? {};
  const packageName = props.package;
  if (typeof packageName !== 'string' || packageName.length === 0) return null;

  const childImports = (node.children ?? []).filter((child) => child.type === 'import');
  const registry = importRegistryOf(props.registry);
  const imports =
    childImports.length > 0
      ? childImports.map((child) => importBindingFromProps(child.props ?? {}, child.loc))
      : [importBindingFromProps(props, node.loc)];

  return {
    package: packageName,
    registry,
    target: importTargetOf(props.target, props.registry),
    targetFamily: importTargetFamilyOf(props.target, props.registry),
    island,
    runtime: inheritString(props, 'runtime', island),
    protocol: inheritString(props, 'protocol', island),
    module: inheritString(props, 'module', island),
    args: inheritArgs(props, island),
    session: inheritString(props, 'session', island),
    options: inheritString(props, 'options', island),
    error: inheritString(props, 'error', island),
    timeout: inheritString(props, 'timeout', island),
    effects: mergeEffects(props, island),
    serialization: inheritString(props, 'serialization', island),
    requiresSidecar: boolProp(props, 'requiresSidecar') || island?.requiresSidecar === true,
    version: inheritString(props, 'version', island),
    review: inheritString(props, 'review', island),
    reason: inheritString(props, 'reason', island),
    imports,
    line: node.loc?.line,
    col: node.loc?.col,
  };
}

function boundaryFromImport(node: IRNode, island?: CapabilityIslandRef): ExternalBoundary | null {
  const props = node.props ?? {};
  const registry = importRegistryOf(props.registry);
  if (registry === 'host') return null;

  const packageName =
    typeof props.package === 'string' && props.package.length > 0
      ? props.package
      : typeof props.from === 'string' && props.from.length > 0
        ? props.from
        : '';
  if (!packageName) return null;

  const boundary: ExternalBoundary = {
    package: packageName,
    registry,
    target: importTargetOf(props.target, props.registry),
    targetFamily: importTargetFamilyOf(props.target, props.registry),
    island,
    runtime: inheritString(props, 'runtime', island),
    protocol: inheritString(props, 'protocol', island),
    module: inheritString(props, 'module', island),
    args: inheritArgs(props, island),
    session: inheritString(props, 'session', island),
    options: inheritString(props, 'options', island),
    error: inheritString(props, 'error', island),
    timeout: inheritString(props, 'timeout', island),
    effects: mergeEffects(props, island),
    serialization: inheritString(props, 'serialization', island),
    requiresSidecar: boolProp(props, 'requiresSidecar') || island?.requiresSidecar === true,
    version: inheritString(props, 'version', island),
    review: inheritString(props, 'review', island),
    reason: inheritString(props, 'reason', island),
    imports: [importBindingFromProps(props, node.loc)],
    line: node.loc?.line,
    col: node.loc?.col,
  };
  if (typeof props.package === 'string' && props.package.length > 0) {
    Object.defineProperty(boundary, 'explicitPackage', {
      value: true,
      enumerable: false,
      configurable: true,
    });
  }
  return boundary;
}

function walk(node: IRNode, out: ExternalBoundary[], insideExtern = false, island?: CapabilityIslandRef): void {
  if (node.type === 'extern') {
    const boundary = boundaryFromExtern(node, island);
    if (boundary) out.push(boundary);
    for (const child of node.children ?? []) {
      walk(child, out, true, island);
    }
    return;
  }
  const nextIsland = node.type === 'island' ? (islandRefFromNode(node) ?? island) : island;
  if (!insideExtern && node.type === 'import') {
    const boundary = boundaryFromImport(node, nextIsland);
    if (boundary) out.push(boundary);
  }
  for (const child of node.children ?? []) {
    walk(child, out, insideExtern, nextIsland);
  }
}

export function collectExternalBoundaries(root: IRNode): ExternalBoundary[] {
  const out: ExternalBoundary[] = [];
  walk(root, out);
  return out;
}

function collectIslandImports(node: IRNode, island: CapabilityIslandRef): ExternalBoundary[] {
  const imports: ExternalBoundary[] = [];
  for (const child of node.children ?? []) {
    if (child.type === 'import') {
      const boundary = boundaryFromImport(child, island);
      if (boundary) imports.push(boundary);
    } else if (child.type === 'extern') {
      const boundary = boundaryFromExtern(child, island);
      if (boundary) imports.push(boundary);
    }
  }
  return imports;
}

function islandFromNode(node: IRNode): CapabilityIsland | null {
  const island = islandRefFromNode(node);
  if (!island) return null;

  return {
    ...island,
    imports: collectIslandImports(node, island),
  };
}

function walkIslands(node: IRNode, out: CapabilityIsland[]): void {
  if (node.type === 'island') {
    const island = islandFromNode(node);
    if (island) out.push(island);
  }
  for (const child of node.children ?? []) {
    walkIslands(child, out);
  }
}

export function collectCapabilityIslands(root: IRNode): CapabilityIsland[] {
  const out: CapabilityIsland[] = [];
  walkIslands(root, out);
  return out;
}

function isPythonSidecarBoundary(boundary: ExternalBoundary): boolean {
  return isPythonSidecarBoundaryShape(boundary);
}

function isLoosePythonBoundary(boundary: ExternalBoundary): boolean {
  return isLoosePythonBoundaryShape(boundary);
}

function hasRuntimeImports(boundary: ExternalBoundary): boolean {
  return hasExternalRuntimeImports(boundary);
}

function sidecarPackageFromBoundary(boundary: ExternalBoundary): SidecarPackage {
  return externalSidecarPackageFromBoundary(boundary);
}

export function sidecarManifestFromIsland(island: CapabilityIsland): SidecarManifest | null {
  if (island.requiresSidecar !== true || island.runtime !== 'python') return null;
  const packages: SidecarPackage[] = island.imports.filter(isPythonSidecarBoundary).map(sidecarPackageFromBoundary);

  const protocol = island.protocol;
  if (packages.length === 0 && !protocol) return null;
  const manifest: SidecarManifest = {
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

export function sidecarManifestFromNode(node: IRNode): SidecarManifest | null {
  if (node.type !== 'island') return null;
  const island = islandFromNode(node);
  return island ? sidecarManifestFromIsland(island) : null;
}

export function collectSidecarManifests(root: IRNode): SidecarManifest[] {
  const manifests: SidecarManifest[] = [];
  for (const island of collectCapabilityIslands(root)) {
    const manifest = sidecarManifestFromIsland(island);
    if (manifest) manifests.push(manifest);
  }
  const looseManifests = new Map<string, SidecarManifest>();
  for (const boundary of collectExternalBoundaries(root).filter(isLoosePythonBoundary)) {
    const name = loosePythonSidecarName(boundary);
    const sidecarPackage = sidecarPackageFromBoundary(boundary);
    const existing = looseManifests.get(name);
    if (!existing) {
      const manifest: SidecarManifest = {
        name,
        kind: 'sidecar',
        runtime: 'python',
        effects: boundary.effects,
        serialization: boundary.serialization ?? 'json',
        requiresSidecar: true,
        packages: [sidecarPackage],
      };
      if (boundary.line !== undefined) manifest.line = boundary.line;
      if (boundary.col !== undefined) manifest.col = boundary.col;
      looseManifests.set(name, manifest);
      continue;
    }
    existing.effects = [...new Set([...existing.effects, ...boundary.effects])];
    const packageKey = externalSidecarPackageKey(sidecarPackage);
    const existingPackage = existing.packages.find(
      (pkg) => externalSidecarPackageKey(pkg) === packageKey,
    );
    if (existingPackage) {
      existingPackage.imports.push(...sidecarPackage.imports);
      if (!existingPackage.version && sidecarPackage.version) existingPackage.version = sidecarPackage.version;
    } else {
      existing.packages.push(sidecarPackage);
    }
  }
  manifests.push(...looseManifests.values());
  return manifests;
}

function loosePythonSidecarName(boundary: ExternalBoundary): string {
  const alias = boundary.imports.find((binding) => binding.default)?.default;
  return pythonSidecarNameFromAliasAndPackage(alias, boundary.package);
}
