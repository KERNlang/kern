import { decodeCanonicalValue, encodeCanonicalValue } from '../canonical-value/canonical.js';
import { type CanonicalValue, CanonicalValueDecodeError, type CanonicalValueLimits } from '../canonical-value/types.js';
import { compareCodePoints } from '../canonical-value/validate.js';
import { STRUCTURAL_KIR_CONSTITUTION_FORMAT, STRUCTURAL_KIR_PROOF_LABEL } from './catalog.generated.js';
import { deriveModuleGraph } from './module-graph.js';
import { compareBindingKey, normalizeModuleId } from './module-path.js';
import {
  MODULE_KIR_ARTIFACT_FORMAT,
  MODULE_KIR_SYMBOL_CATALOG_FORMAT,
  MODULE_KIR_SYMBOL_KINDS,
  type ModuleKirArtifact,
  type ModuleKirBinding,
  ModuleKirError,
  type ModuleKirExport,
  type ModuleKirImport,
  type ModuleKirInput,
  type ModuleKirModule,
  type ModuleKirSymbolKind,
} from './module-types.js';
import { projectStructuralNode, validateStructuralNode } from './node.js';
import { StructuralKirError, type StructuralKirNode } from './types.js';

function fail(code: ConstructorParameters<typeof ModuleKirError>[0], path: string, message: string): never {
  throw new ModuleKirError(code, path, message);
}

function nodeValue(node: StructuralKirNode): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'children', value: { tag: 'list', value: node.children.map(nodeValue) } },
      { key: 'kind', value: { tag: 'text', value: node.kind } },
      { key: 'properties', value: { tag: 'record', value: node.properties } },
    ],
  };
}

function bindingValue(binding: ModuleKirBinding): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'imported', value: { tag: 'text', value: binding.imported } },
      { key: 'kind', value: { tag: 'text', value: binding.kind } },
      { key: 'local', value: { tag: 'text', value: binding.local } },
      { key: 'reexport', value: { tag: 'bool', value: binding.reexport } },
    ],
  };
}

function importValue(imported: ModuleKirImport): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'bindings', value: { tag: 'list', value: imported.bindings.map(bindingValue) } },
      { key: 'source', value: { tag: 'text', value: imported.source } },
    ],
  };
}

function exportValue(exported: ModuleKirExport): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'kind', value: { tag: 'text', value: exported.kind } },
      { key: 'name', value: { tag: 'text', value: exported.name } },
      { key: 'source', value: exported.source === null ? { tag: 'null' } : { tag: 'text', value: exported.source } },
    ],
  };
}

function moduleValue(module: ModuleKirModule): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'exports', value: { tag: 'list', value: module.exports.map(exportValue) } },
      { key: 'id', value: { tag: 'text', value: module.id } },
      { key: 'imports', value: { tag: 'list', value: module.imports.map(importValue) } },
      { key: 'roots', value: { tag: 'list', value: module.roots.map(nodeValue) } },
    ],
  };
}

function artifactValue(modules: readonly ModuleKirModule[]): CanonicalValue {
  return {
    tag: 'record',
    value: [
      { key: 'constitution', value: { tag: 'text', value: STRUCTURAL_KIR_CONSTITUTION_FORMAT } },
      { key: 'diagnostics', value: { tag: 'list', value: [] } },
      { key: 'format', value: { tag: 'text', value: MODULE_KIR_ARTIFACT_FORMAT } },
      { key: 'modules', value: { tag: 'list', value: modules.map(moduleValue) } },
      { key: 'proofLabel', value: { tag: 'text', value: STRUCTURAL_KIR_PROOF_LABEL } },
      {
        key: 'symbolCatalog',
        value: {
          tag: 'record',
          value: [
            {
              key: 'admittedKinds',
              value: { tag: 'list', value: MODULE_KIR_SYMBOL_KINDS.map((kind) => ({ tag: 'text', value: kind })) },
            },
            { key: 'format', value: { tag: 'text', value: MODULE_KIR_SYMBOL_CATALOG_FORMAT } },
          ],
        },
      },
    ],
  };
}

function exact(value: CanonicalValue, keys: readonly string[], path: string): Map<string, CanonicalValue> {
  if (
    value.tag !== 'record' ||
    value.value.length !== keys.length ||
    value.value.some((entry, index) => entry.key !== keys[index])
  ) {
    fail('invalid-module-artifact', path, `expected fields ${keys.join(',')}`);
  }
  return new Map(value.value.map((entry) => [entry.key, entry.value]));
}

function field(record: Map<string, CanonicalValue>, name: string): CanonicalValue {
  const value = record.get(name);
  if (value === undefined) fail('invalid-module-artifact', `$.${name}`, `missing field ${name}`);
  return value;
}

function text(value: CanonicalValue, path: string): string {
  if (value.tag !== 'text') fail('invalid-module-artifact', path, 'expected text');
  return value.value;
}

function boolean(value: CanonicalValue, path: string): boolean {
  if (value.tag !== 'bool') fail('invalid-module-artifact', path, 'expected boolean');
  return value.value;
}

function list(value: CanonicalValue, path: string): readonly CanonicalValue[] {
  if (value.tag !== 'list') fail('invalid-module-artifact', path, 'expected list');
  return value.value;
}

function expectedText(value: CanonicalValue, expected: string, path: string): void {
  if (value.tag !== 'text' || value.value !== expected)
    fail('unsupported-module-version', path, `expected ${expected}`);
}

function kind(value: CanonicalValue, path: string): ModuleKirSymbolKind {
  const result = text(value, path);
  if (!(MODULE_KIR_SYMBOL_KINDS as readonly string[]).includes(result)) {
    fail('invalid-symbol', path, `symbol kind ${result} is not admitted`);
  }
  return result as ModuleKirSymbolKind;
}

function parseBinding(value: CanonicalValue, path: string): ModuleKirBinding {
  const record = exact(value, ['imported', 'kind', 'local', 'reexport'], path);
  return {
    imported: text(field(record, 'imported'), `${path}.imported`),
    kind: kind(field(record, 'kind'), `${path}.kind`),
    local: text(field(record, 'local'), `${path}.local`),
    reexport: boolean(field(record, 'reexport'), `${path}.reexport`),
  };
}

function parseImport(value: CanonicalValue, path: string): ModuleKirImport {
  const record = exact(value, ['bindings', 'source'], path);
  const bindings = list(field(record, 'bindings'), `${path}.bindings`).map((item, index) =>
    parseBinding(item, `${path}.bindings[${index}]`),
  );
  bindings.forEach((binding, index) => {
    if (index > 0 && compareBindingKey(bindings[index - 1] as ModuleKirBinding, binding) >= 0) {
      fail('invalid-module-artifact', `${path}.bindings[${index}]`, 'bindings must be strictly sorted');
    }
  });
  return { bindings, source: text(field(record, 'source'), `${path}.source`) };
}

function parseExport(value: CanonicalValue, path: string): ModuleKirExport {
  const record = exact(value, ['kind', 'name', 'source'], path);
  const source = field(record, 'source');
  return {
    kind: kind(field(record, 'kind'), `${path}.kind`),
    name: text(field(record, 'name'), `${path}.name`),
    source: source.tag === 'null' ? null : text(source, `${path}.source`),
  };
}

function parseModule(value: CanonicalValue, path: string): ModuleKirModule {
  const record = exact(value, ['exports', 'id', 'imports', 'roots'], path);
  const exports = list(field(record, 'exports'), `${path}.exports`).map((item, index) =>
    parseExport(item, `${path}.exports[${index}]`),
  );
  const imports = list(field(record, 'imports'), `${path}.imports`).map((item, index) =>
    parseImport(item, `${path}.imports[${index}]`),
  );
  exports.forEach((item, index) => {
    const previous = exports[index - 1];
    if (previous && compareCodePoints(previous.name, item.name) === 0) {
      fail('duplicate-export', `${path}.exports[${index}]`, `duplicate ${item.name}`);
    }
    if (previous && compareCodePoints(previous.name, item.name) > 0) {
      fail('invalid-module-artifact', `${path}.exports[${index}]`, 'exports must be strictly sorted');
    }
  });
  imports.forEach((item, index) => {
    if (index > 0 && imports[index - 1] && compareCodePoints(imports[index - 1].source, item.source) >= 0) {
      fail('invalid-module-artifact', `${path}.imports[${index}]`, 'imports must be strictly sorted');
    }
  });
  const id = normalizeModuleId(text(field(record, 'id'), `${path}.id`), `${path}.id`);
  const roots = list(field(record, 'roots'), `${path}.roots`).map((root, index) =>
    validateStructuralNode(root, `${path}.roots[${index}]`),
  );
  return { exports, id, imports, roots };
}

function sameModule(left: ModuleKirModule, right: ModuleKirModule): boolean {
  return JSON.stringify(moduleValue(left)) === JSON.stringify(moduleValue(right));
}

function parseArtifact(value: CanonicalValue): ModuleKirArtifact {
  const artifact = exact(
    value,
    ['constitution', 'diagnostics', 'format', 'modules', 'proofLabel', 'symbolCatalog'],
    '$',
  );
  expectedText(field(artifact, 'constitution'), STRUCTURAL_KIR_CONSTITUTION_FORMAT, '$.constitution');
  expectedText(field(artifact, 'format'), MODULE_KIR_ARTIFACT_FORMAT, '$.format');
  expectedText(field(artifact, 'proofLabel'), STRUCTURAL_KIR_PROOF_LABEL, '$.proofLabel');
  if (list(field(artifact, 'diagnostics'), '$.diagnostics').length !== 0) {
    fail('invalid-module-artifact', '$.diagnostics', 'diagnostics are deferred to R1.5d');
  }
  const catalog = exact(field(artifact, 'symbolCatalog'), ['admittedKinds', 'format'], '$.symbolCatalog');
  const kinds = list(field(catalog, 'admittedKinds'), '$.symbolCatalog.admittedKinds');
  if (
    kinds.length !== MODULE_KIR_SYMBOL_KINDS.length ||
    kinds.some((item, index) => item.tag !== 'text' || item.value !== MODULE_KIR_SYMBOL_KINDS[index])
  ) {
    fail('invalid-module-artifact', '$.symbolCatalog.admittedKinds', 'expected exact class,fn catalog');
  }
  expectedText(field(catalog, 'format'), MODULE_KIR_SYMBOL_CATALOG_FORMAT, '$.symbolCatalog.format');
  const modules = list(field(artifact, 'modules'), '$.modules').map((item, index) =>
    parseModule(item, `$.modules[${index}]`),
  );
  modules.forEach((module, index) => {
    if (index > 0 && modules[index - 1] && compareCodePoints(modules[index - 1].id, module.id) >= 0) {
      fail('invalid-module-artifact', `$.modules[${index}].id`, 'modules must be strictly sorted');
    }
  });
  const derived = deriveModuleGraph(modules.map((module) => ({ id: module.id, roots: module.roots })));
  modules.forEach((module, index) => {
    if (!sameModule(module, derived[index] as ModuleKirModule)) {
      fail('metadata-mismatch', `$.modules[${index}]`, 'serialized graph metadata differs from embedded root');
    }
  });
  return {
    constitution: STRUCTURAL_KIR_CONSTITUTION_FORMAT,
    diagnostics: [],
    format: MODULE_KIR_ARTIFACT_FORMAT,
    modules,
    proofLabel: STRUCTURAL_KIR_PROOF_LABEL,
    symbolCatalog: { admittedKinds: MODULE_KIR_SYMBOL_KINDS, format: MODULE_KIR_SYMBOL_CATALOG_FORMAT },
  };
}

function inspectInputs(inputs: readonly ModuleKirInput[]): readonly ModuleKirInput[] {
  if (!Array.isArray(inputs)) fail('invalid-module-artifact', '$.modules', 'expected plain module array');
  try {
    if (Object.getPrototypeOf(inputs) !== Array.prototype || Object.keys(inputs).length !== inputs.length) {
      fail('invalid-module-artifact', '$.modules', 'expected dense plain module array');
    }
    return inputs.map((input, index) => {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        fail('invalid-module-artifact', `$.modules[${index}]`, 'expected plain module input');
      }
      if (Object.getPrototypeOf(input) !== Object.prototype) {
        fail('invalid-module-artifact', `$.modules[${index}]`, 'expected plain module input');
      }
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const keys = Object.keys(descriptors).sort();
      if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'roots') {
        fail('invalid-module-artifact', `$.modules[${index}]`, 'expected exact id,roots fields');
      }
      if (Object.values(descriptors).some((descriptor) => descriptor.get || descriptor.set || !descriptor.enumerable)) {
        fail('invalid-module-artifact', `$.modules[${index}]`, 'module input must be inspectable plain data');
      }
      return input;
    });
  } catch (error) {
    if (error instanceof ModuleKirError) throw error;
    fail('invalid-module-artifact', '$.modules', 'module inputs are not safely inspectable');
  }
}

export function encodeModuleKir(inputs: readonly ModuleKirInput[], limits: CanonicalValueLimits): Uint8Array {
  try {
    const projected = inspectInputs(inputs).map((input, index) => {
      if (
        !Array.isArray(input.roots) ||
        Object.getPrototypeOf(input.roots) !== Array.prototype ||
        Object.keys(input.roots).length !== input.roots.length
      ) {
        fail('invalid-module-artifact', `$.modules[${index}].roots`, 'expected dense plain root array');
      }
      return { id: input.id, roots: input.roots.map((root) => projectStructuralNode(root, limits)) };
    });
    return encodeCanonicalValue(artifactValue(deriveModuleGraph(projected)), limits);
  } catch (error) {
    if (
      error instanceof ModuleKirError ||
      error instanceof StructuralKirError ||
      error instanceof CanonicalValueDecodeError
    )
      throw error;
    if (error instanceof RangeError)
      throw new CanonicalValueDecodeError('limit-depth', '$.modules', 'module artifact exceeds host-safe depth');
    fail('invalid-module-artifact', '$', 'module artifact cannot be encoded');
  }
}

export function decodeModuleKir(input: Uint8Array, limits: CanonicalValueLimits): ModuleKirArtifact {
  try {
    return parseArtifact(decodeCanonicalValue(input, limits));
  } catch (error) {
    if (
      error instanceof ModuleKirError ||
      error instanceof StructuralKirError ||
      error instanceof CanonicalValueDecodeError
    )
      throw error;
    if (error instanceof RangeError)
      throw new CanonicalValueDecodeError('limit-depth', '$.modules', 'module artifact exceeds host-safe depth');
    fail('invalid-module-artifact', '$', 'module artifact cannot be decoded');
  }
}
