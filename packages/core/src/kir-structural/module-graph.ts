import type { CanonicalValue } from '../canonical-value/types.js';
import { compareCodePoints } from '../canonical-value/validate.js';
import { compareBindingKey, normalizeModuleId, resolveModuleTarget } from './module-path.js';
import {
  MODULE_KIR_ROOT_KINDS,
  MODULE_KIR_SYMBOL_KINDS,
  type ModuleKirBinding,
  ModuleKirError,
  type ModuleKirExport,
  type ModuleKirModule,
  type ModuleKirSymbolKind,
} from './module-types.js';
import type { StructuralKirNode } from './types.js';

function fail(code: ConstructorParameters<typeof ModuleKirError>[0], path: string, message: string): never {
  throw new ModuleKirError(code, path, message);
}

function property(node: StructuralKirNode, name: string): CanonicalValue | undefined {
  return node.properties.find((entry) => entry.key === name)?.value;
}

function textProperty(node: StructuralKirNode, name: string, path: string): string {
  const value = property(node, name);
  if (value?.tag !== 'text') fail('invalid-symbol', `${path}.properties.${name}`, 'expected text');
  return value.value;
}

function optionalText(node: StructuralKirNode, name: string, path: string): string | undefined {
  const value = property(node, name);
  if (value === undefined) return undefined;
  if (value.tag !== 'text') fail('invalid-symbol', `${path}.properties.${name}`, 'expected text');
  return value.value;
}

function optionalBoolean(node: StructuralKirNode, name: string, path: string): boolean {
  const value = property(node, name);
  if (value === undefined) return false;
  if (value.tag !== 'bool') fail('invalid-symbol', `${path}.properties.${name}`, 'expected boolean');
  return value.value;
}

function symbolKind(value: string, path: string): ModuleKirSymbolKind {
  if (!(MODULE_KIR_SYMBOL_KINDS as readonly string[]).includes(value)) {
    fail('invalid-symbol', path, `symbol kind ${value} is not admitted`);
  }
  return value as ModuleKirSymbolKind;
}

interface ModuleSeed {
  readonly id: string;
  readonly roots: readonly StructuralKirNode[];
  readonly declarations: ReadonlyMap<string, ModuleKirSymbolKind>;
  readonly exports: readonly ModuleKirExport[];
}

function seedModule(id: string, roots: readonly StructuralKirNode[], path: string): ModuleSeed {
  const declarations = new Map<string, ModuleKirSymbolKind>();
  const exports: ModuleKirExport[] = [];
  roots.forEach((node, index) => {
    if (!(MODULE_KIR_ROOT_KINDS as readonly string[]).includes(node.kind)) {
      fail('invalid-module-root', `${path}.roots[${index}].kind`, `root kind ${node.kind} is not admitted`);
    }
    if (!(MODULE_KIR_SYMBOL_KINDS as readonly string[]).includes(node.kind)) return;
    const nodePath = `${path}.roots[${index}]`;
    const name = textProperty(node, 'name', nodePath);
    if (declarations.has(name)) fail('duplicate-local-binding', `${nodePath}.properties.name`, `duplicate ${name}`);
    const kind = node.kind as ModuleKirSymbolKind;
    declarations.set(name, kind);
    if (optionalBoolean(node, 'export', nodePath)) exports.push({ kind, name, source: null });
  });
  exports.sort((left, right) => compareCodePoints(left.name, right.name));
  return { id, roots, declarations, exports };
}

interface ModuleUse {
  readonly node: StructuralKirNode;
  readonly path: string;
  readonly target: string;
}

function collectModuleUses(seed: ModuleSeed, ids: ReadonlySet<string>, path: string): readonly ModuleUse[] {
  const uses: ModuleUse[] = [];
  seed.roots.forEach((node, nodeIndex) => {
    if (node.kind !== 'use') return;
    const nodePath = `${path}.roots[${nodeIndex}]`;
    const specifier = textProperty(node, 'path', nodePath);
    const target = resolveModuleTarget(seed.id, specifier, ids, `${nodePath}.properties.path`);
    uses.push({ node, path: nodePath, target });
  });
  return uses;
}

function linkModule(
  seed: ModuleSeed,
  uses: readonly ModuleUse[],
  linkedById: ReadonlyMap<string, ModuleKirModule>,
): ModuleKirModule {
  const importsBySource = new Map<string, ModuleKirBinding[]>();
  const exports = [...seed.exports];
  const exportNames = new Set(exports.map((item) => item.name));
  const localNames = new Set(seed.declarations.keys());
  for (const use of uses) {
    const targetExports = new Map(linkedById.get(use.target)?.exports.map((item) => [item.name, item]));
    const bindings = importsBySource.get(use.target) ?? [];
    importsBySource.set(use.target, bindings);
    use.node.children.forEach((bindingNode, bindingIndex) => {
      const bindingPath = `${use.path}.children[${bindingIndex}]`;
      if (bindingNode.kind !== 'from') fail('invalid-symbol', `${bindingPath}.kind`, 'use children must be from');
      const imported = textProperty(bindingNode, 'name', bindingPath);
      const targetExport = targetExports.get(imported);
      if (targetExport === undefined) fail('missing-export', `${bindingPath}.properties.name`, `missing ${imported}`);
      const declaredKind = optionalText(bindingNode, 'kind', bindingPath);
      const kind =
        declaredKind === undefined ? targetExport.kind : symbolKind(declaredKind, `${bindingPath}.properties.kind`);
      if (kind !== targetExport.kind) {
        fail('kind-mismatch', `${bindingPath}.properties.kind`, `expected ${kind}; found ${targetExport.kind}`);
      }
      const local = optionalText(bindingNode, 'as', bindingPath) ?? imported;
      if (localNames.has(local)) fail('duplicate-local-binding', `${bindingPath}.properties.as`, `duplicate ${local}`);
      localNames.add(local);
      const reexport = optionalBoolean(bindingNode, 'export', bindingPath);
      if (reexport) {
        if (exportNames.has(local)) fail('duplicate-export', `${bindingPath}.properties.export`, `duplicate ${local}`);
        exportNames.add(local);
        exports.push({ kind, name: local, source: use.target });
      }
      bindings.push({ imported, kind, local, reexport });
    });
  }
  const imports = [...importsBySource.entries()]
    .map(([source, bindings]) => ({ bindings: bindings.sort(compareBindingKey), source }))
    .sort((left, right) => compareCodePoints(left.source, right.source));
  exports.sort((left, right) => compareCodePoints(left.name, right.name));
  return { exports, id: seed.id, imports, roots: seed.roots };
}

function assertAcyclic(graph: ReadonlyMap<string, readonly string[]>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, trail: readonly string[]) => {
    if (visiting.has(id)) fail('module-cycle', '$.modules', `cycle ${[...trail, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of graph.get(id) ?? []) visit(target, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...graph.keys()].sort(compareCodePoints)) visit(id, []);
}

export function deriveModuleGraph(
  inputs: readonly { id: string; roots: readonly StructuralKirNode[] }[],
): ModuleKirModule[] {
  if (inputs.length === 0) fail('invalid-module-artifact', '$.modules', 'expected at least one module');
  const seeds = new Map<string, ModuleSeed>();
  const normalized = inputs
    .map((input, index) => ({ id: normalizeModuleId(input.id, `$.modules[${index}].id`), roots: input.roots }))
    .sort((left, right) => compareCodePoints(left.id, right.id));
  normalized.forEach((input, index) => {
    const id = normalizeModuleId(input.id, `$.modules[${index}].id`);
    if (seeds.has(id)) fail('invalid-module-id', `$.modules[${index}].id`, `duplicate ${id}`);
    seeds.set(id, seedModule(id, input.roots, `$.modules[${index}]`));
  });
  const ids = new Set(seeds.keys());
  const sortedSeeds = [...seeds.values()].sort((left, right) => compareCodePoints(left.id, right.id));
  const usesById = new Map(
    sortedSeeds.map((seed, index) => [seed.id, collectModuleUses(seed, ids, `$.modules[${index}]`)]),
  );
  const graph = new Map(sortedSeeds.map((seed) => [seed.id, (usesById.get(seed.id) ?? []).map((use) => use.target)]));
  assertAcyclic(graph);
  const linked = new Map<string, ModuleKirModule>();
  const link = (seed: ModuleSeed): ModuleKirModule => {
    const existing = linked.get(seed.id);
    if (existing !== undefined) return existing;
    for (const use of usesById.get(seed.id) ?? []) link(seeds.get(use.target) as ModuleSeed);
    const module = linkModule(seed, usesById.get(seed.id) ?? [], linked);
    linked.set(seed.id, module);
    return module;
  };
  return sortedSeeds.map(link);
}
