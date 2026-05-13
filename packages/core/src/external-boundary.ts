import {
  type ExternalImportRegistry,
  type ExternalImportTarget,
  importRegistryOf,
  importTargetFamilyOf,
  importTargetOf,
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
  runtime?: string;
  effects: string[];
  serialization?: string;
  version?: string;
  review?: string;
  reason?: string;
  imports: ExternalImportBinding[];
  line?: number;
  col?: number;
}

function splitNames(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
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

function boundaryFromExtern(node: IRNode): ExternalBoundary | null {
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
    runtime: typeof props.runtime === 'string' && props.runtime.length > 0 ? props.runtime : undefined,
    effects: splitNames(props.effects),
    serialization:
      typeof props.serialization === 'string' && props.serialization.length > 0 ? props.serialization : undefined,
    version: typeof props.version === 'string' && props.version.length > 0 ? props.version : undefined,
    review: typeof props.review === 'string' && props.review.length > 0 ? props.review : undefined,
    reason: typeof props.reason === 'string' && props.reason.length > 0 ? props.reason : undefined,
    imports,
    line: node.loc?.line,
    col: node.loc?.col,
  };
}

function boundaryFromImport(node: IRNode): ExternalBoundary | null {
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
    runtime: typeof props.runtime === 'string' && props.runtime.length > 0 ? props.runtime : undefined,
    effects: splitNames(props.effects),
    serialization:
      typeof props.serialization === 'string' && props.serialization.length > 0 ? props.serialization : undefined,
    version: typeof props.version === 'string' && props.version.length > 0 ? props.version : undefined,
    review: typeof props.review === 'string' && props.review.length > 0 ? props.review : undefined,
    reason: typeof props.reason === 'string' && props.reason.length > 0 ? props.reason : undefined,
    imports: [importBindingFromProps(props, node.loc)],
    line: node.loc?.line,
    col: node.loc?.col,
  };
}

function walk(node: IRNode, out: ExternalBoundary[], insideExtern = false): void {
  if (node.type === 'extern') {
    const boundary = boundaryFromExtern(node);
    if (boundary) out.push(boundary);
    for (const child of node.children ?? []) {
      walk(child, out, true);
    }
    return;
  }
  if (!insideExtern && node.type === 'import') {
    const boundary = boundaryFromImport(node);
    if (boundary) out.push(boundary);
  }
  for (const child of node.children ?? []) {
    walk(child, out, insideExtern);
  }
}

export function collectExternalBoundaries(root: IRNode): ExternalBoundary[] {
  const out: ExternalBoundary[] = [];
  walk(root, out);
  return out;
}
