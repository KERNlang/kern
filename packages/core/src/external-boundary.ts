import { type ExternalSignatureMap } from './ecosystem-signatures.js';
import {
  type ExternalImportRegistry,
  type ExternalImportTarget,
  importRegistryOf,
  importTargetFamilyOf,
  importTargetOf,
} from './import-metadata.js';
import {
  type ExternalBoundaryIslandShape,
  externalBoundaryFromExternParts,
  externalBoundaryFromImportParts,
  externalCapabilityIslandFromParts,
  externalImportBindingFromParts,
  externalIslandRefFromParts,
  externalSidecarManifestFromIsland,
  externalSidecarManifestsFromParts,
} from './external-boundary-utils.js';
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

export type CapabilityIslandRef = ExternalBoundaryIslandShape;

export interface CapabilityIsland extends CapabilityIslandRef {
  imports: ExternalBoundary[];
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

function islandRefFromNode(node: IRNode): CapabilityIslandRef | null {
  return externalIslandRefFromParts(node.props ?? {}, node.loc?.line, node.loc?.col);
}

function importBindingFromProps(props: Record<string, unknown>, loc?: IRNode['loc']): ExternalImportBinding {
  return externalImportBindingFromParts(props, loc?.line, loc?.col);
}

function boundaryFromExtern(node: IRNode, island?: CapabilityIslandRef): ExternalBoundary | null {
  const props = node.props ?? {};

  const childImports = (node.children ?? []).filter((child) => child.type === 'import');
  const registry = importRegistryOf(props.registry);
  const imports =
    childImports.length > 0
      ? childImports.map((child) => importBindingFromProps(child.props ?? {}, child.loc))
      : [importBindingFromProps(props, node.loc)];

  return externalBoundaryFromExternParts(
    props,
    registry,
    importTargetOf(props.target, props.registry),
    importTargetFamilyOf(props.target, props.registry),
    island,
    imports,
    node.loc?.line,
    node.loc?.col,
  );
}

function boundaryFromImport(node: IRNode, island?: CapabilityIslandRef): ExternalBoundary | null {
  const props = node.props ?? {};
  const registry = importRegistryOf(props.registry);
  if (registry === 'host') return null;

  return externalBoundaryFromImportParts(
    props,
    registry,
    importTargetOf(props.target, props.registry),
    importTargetFamilyOf(props.target, props.registry),
    island,
    importBindingFromProps(props, node.loc),
    node.loc?.line,
    node.loc?.col,
  );
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
  return externalCapabilityIslandFromParts(island, island ? collectIslandImports(node, island) : []);
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

export function sidecarManifestFromIsland(island: CapabilityIsland): SidecarManifest | null {
  return externalSidecarManifestFromIsland(island);
}

export function sidecarManifestFromNode(node: IRNode): SidecarManifest | null {
  if (node.type !== 'island') return null;
  const island = islandFromNode(node);
  return island ? sidecarManifestFromIsland(island) : null;
}

export function collectSidecarManifests(root: IRNode): SidecarManifest[] {
  return externalSidecarManifestsFromParts(collectCapabilityIslands(root), collectExternalBoundaries(root));
}
