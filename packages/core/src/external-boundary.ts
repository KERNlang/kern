import {
  type ExternalImportRegistry,
  type ExternalImportTarget,
  importRegistryOf,
  importTargetFamilyOf,
  importTargetOf,
  splitCapabilityList,
} from './import-metadata.js';
import type { IRNode } from './types.js';

export interface ExternalImportBinding {
  names: string[];
  default?: string;
  from?: string;
  types: boolean;
  line?: number;
  col?: number;
}

export interface ExternalBoundary {
  package: string;
  registry: ExternalImportRegistry;
  target: ExternalImportTarget;
  targetFamily: 'all' | 'ts' | 'python' | 'none';
  island?: CapabilityIslandRef;
  runtime?: string;
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

function splitNames(value: unknown): string[] {
  return splitCapabilityList(value);
}

function stringProp(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function boolProp(props: Record<string, unknown>, key: string): boolean {
  return props[key] === true || props[key] === 'true';
}

function mergeEffects(props: Record<string, unknown>, island?: CapabilityIslandRef): string[] {
  return [...new Set([...(island?.effects ?? []), ...splitNames(props.effects)])];
}

function inheritString(
  props: Record<string, unknown>,
  key: 'runtime' | 'serialization' | 'version' | 'review' | 'reason',
  island?: CapabilityIslandRef,
): string | undefined {
  return stringProp(props, key) ?? island?.[key];
}

function islandRefFromNode(node: IRNode): CapabilityIslandRef | null {
  const props = node.props ?? {};
  const name = stringProp(props, 'name');
  if (!name) return null;

  return {
    name,
    kind: stringProp(props, 'kind'),
    runtime: stringProp(props, 'runtime'),
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
  return {
    names: splitNames(props.names),
    default: typeof props.default === 'string' && props.default.length > 0 ? props.default : undefined,
    from: typeof props.from === 'string' && props.from.length > 0 ? props.from : undefined,
    types: props.types === true || props.types === 'true',
    line: loc?.line,
    col: loc?.col,
  };
}

function boundaryFromExtern(node: IRNode, island?: CapabilityIslandRef): ExternalBoundary | null {
  const props = node.props ?? {};
  const packageName = props.package;
  if (typeof packageName !== 'string' || packageName.length === 0) return null;

  const childImports = (node.children ?? []).filter((child) => child.type === 'import');
  const imports =
    childImports.length > 0
      ? childImports.map((child) => importBindingFromProps(child.props ?? {}, child.loc))
      : [importBindingFromProps(props, node.loc)];

  return {
    package: packageName,
    registry: importRegistryOf(props.registry),
    target: importTargetOf(props.target, props.registry),
    targetFamily: importTargetFamilyOf(props.target, props.registry),
    island,
    runtime: inheritString(props, 'runtime', island),
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

  return {
    package: packageName,
    registry,
    target: importTargetOf(props.target, props.registry),
    targetFamily: importTargetFamilyOf(props.target, props.registry),
    island,
    runtime: inheritString(props, 'runtime', island),
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
