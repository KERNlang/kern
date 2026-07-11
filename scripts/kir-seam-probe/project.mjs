import path from 'node:path';

import { parseDocumentWithDiagnostics, parseExpression } from '../../packages/core/dist/index.js';
import { NODE_SCHEMAS } from '../../packages/core/dist/schema.js';
import { compareCodePoints, PROBE_FORMAT, PROBE_NODE_KINDS } from './model.mjs';

const PORTABLE_BINARY = new Set(['+', '-', '*', '/', '%', '**', '==', '!=', '<', '<=', '>', '>=', '&&', '||', '??', '&', '|', '^', '<<', '>>']);
const PORTABLE_UNARY = new Set(['!', '-', '+', '~']);

function entries(record) {
  return Object.entries(record)
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([key, value]) => ({ key, value }));
}

function expression(kind, fields = {}) {
  return { tag: 'expression', value: { kind, fields: entries(fields) } };
}

function exactInteger(raw, pathName) {
  if (!/^(?:0|-?[1-9][0-9]*)$/u.test(raw)) throw new TypeError(`${pathName}: non-canonical integer literal ${raw}`);
  if (!Number.isSafeInteger(Number(raw))) throw new TypeError(`${pathName}: unsafe integer literal ${raw}`);
  return raw;
}

function decimalCall(node) {
  return node.kind === 'call' && !node.optional && node.args.length === 1 &&
    node.callee.kind === 'member' && !node.callee.optional && node.callee.property === 'of' &&
    node.callee.object.kind === 'ident' && node.callee.object.name === 'Decimal' && node.args[0].kind === 'strLit';
}

export function projectExpression(node, pathName = 'expression') {
  if (node.kind === 'numLit') {
    if (node.bigint) throw new TypeError(`${pathName}: bigint literals are outside the probe`);
    return expression('integer', { value: { tag: 'int', value: exactInteger(node.raw, pathName) } });
  }
  if (node.kind === 'unary' && node.op === '-' && node.argument.kind === 'numLit' && node.argument.raw === '0') {
    return expression('negative-zero');
  }
  if (decimalCall(node)) {
    const value = node.args[0].value;
    if (!/^-?(?:0|[1-9][0-9]*)\.[0-9]+$/u.test(value)) throw new TypeError(`${pathName}: invalid exact Decimal text`);
    return expression('decimal', { value: { tag: 'decimal', value } });
  }
  if (node.kind === 'strLit') return expression('text', { value: { tag: 'text', value: node.value } });
  if (node.kind === 'boolLit') return expression('boolean', { value: { tag: 'bool', value: node.value } });
  if (node.kind === 'nullLit') return expression('null');
  if (node.kind === 'ident') return expression('identifier', { name: { tag: 'text', value: node.name } });
  if (node.kind === 'regexLit') {
    const flags = [...node.flags].sort().join('');
    return expression('regex', { value: { tag: 'regex', value: { pattern: node.pattern, flags } } });
  }
  if (node.kind === 'arrayLit') {
    return expression('list', { items: { tag: 'list', value: node.items.map((item, index) => projectExpression(item, `${pathName}[${index}]`)) } });
  }
  if (node.kind === 'objectLit') {
    const projected = [];
    const seen = new Set();
    for (const [index, item] of node.entries.entries()) {
      if ('kind' in item) throw new TypeError(`${pathName}[${index}]: record spread is outside the probe`);
      if (typeof item.key !== 'string') throw new TypeError(`${pathName}[${index}]: computed record key is outside the probe`);
      if (seen.has(item.key)) throw new TypeError(`${pathName}[${index}]: duplicate record key ${JSON.stringify(item.key)}`);
      seen.add(item.key);
      projected.push({ key: item.key, value: projectExpression(item.value, `${pathName}.${item.key}`) });
    }
    projected.sort((left, right) => compareCodePoints(left.key, right.key));
    return expression('record', { entries: { tag: 'record', value: projected } });
  }
  if (node.kind === 'member') {
    return expression('member', {
      object: projectExpression(node.object, `${pathName}.object`),
      property: { tag: 'text', value: node.property },
      optional: { tag: 'bool', value: node.optional ?? false },
    });
  }
  if (node.kind === 'index') {
    return expression('index', {
      object: projectExpression(node.object, `${pathName}.object`),
      index: projectExpression(node.index, `${pathName}.index`),
      optional: { tag: 'bool', value: node.optional ?? false },
    });
  }
  if (node.kind === 'call') {
    if (node.typeArgs !== undefined) throw new TypeError(`${pathName}: host type arguments are outside the probe`);
    return expression('call', {
      callee: projectExpression(node.callee, `${pathName}.callee`),
      arguments: { tag: 'list', value: node.args.map((item, index) => projectExpression(item, `${pathName}.arguments[${index}]`)) },
      optional: { tag: 'bool', value: node.optional ?? false },
    });
  }
  if (node.kind === 'lambda') {
    if (node.bodyBlock !== undefined || node.body === undefined) throw new TypeError(`${pathName}: raw block closure is outside semantic KIR`);
    if (node.returnType !== undefined || node.params.some((parameter) => parameter.type !== undefined)) {
      throw new TypeError(`${pathName}: host type annotations are outside the probe`);
    }
    if (node.params.some((parameter) => Object.keys(parameter).some((key) => key !== 'name' && key !== 'type'))) {
      throw new TypeError(`${pathName}: extended lambda parameters are outside the probe`);
    }
    return expression('lambda', {
      parameters: { tag: 'list', value: node.params.map((parameter) => ({ tag: 'text', value: parameter.name })) },
      body: projectExpression(node.body, `${pathName}.body`),
    });
  }
  if (node.kind === 'binary') {
    if (!PORTABLE_BINARY.has(node.op)) throw new TypeError(`${pathName}: non-portable binary operator ${node.op}`);
    return expression('binary', {
      operator: { tag: 'text', value: node.op },
      left: projectExpression(node.left, `${pathName}.left`),
      right: projectExpression(node.right, `${pathName}.right`),
    });
  }
  if (node.kind === 'unary') {
    if (!PORTABLE_UNARY.has(node.op)) throw new TypeError(`${pathName}: non-portable unary operator ${node.op}`);
    return expression('unary', {
      operator: { tag: 'text', value: node.op },
      argument: projectExpression(node.argument, `${pathName}.argument`),
    });
  }
  if (node.kind === 'conditional') {
    return expression('conditional', {
      test: projectExpression(node.test, `${pathName}.test`),
      consequent: projectExpression(node.consequent, `${pathName}.consequent`),
      alternate: projectExpression(node.alternate, `${pathName}.alternate`),
    });
  }
  throw new TypeError(`${pathName}: ${node.kind} is outside portable semantic KIR`);
}

function location(loc) {
  if (!Number.isSafeInteger(loc?.line) || loc.line < 1 || !Number.isSafeInteger(loc?.col) || loc.col < 1) {
    throw new TypeError('probe node is missing a valid start location');
  }
  return {
    start: { line: loc.line, column: loc.col },
    end: loc?.endLine === undefined || loc?.endCol === undefined ? null : { line: loc.endLine, column: loc.endCol },
  };
}

function scalarValue(value, pathName) {
  if (value === null) return { tag: 'null' };
  if (typeof value === 'boolean') return { tag: 'bool', value };
  if (typeof value === 'string') return { tag: 'text', value };
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return { tag: 'negative-zero' };
    if (!Number.isSafeInteger(value)) throw new TypeError(`${pathName}: unsafe or fractional numeric property`);
    return { tag: 'int', value: String(value) };
  }
  throw new TypeError(`${pathName}: raw host value is outside the probe`);
}

function propertyValue(value, schema, pathName) {
  if (schema?.kind === 'boolean' && (value === 'true' || value === 'false')) {
    return { tag: 'bool', value: value === 'true' };
  }
  return scalarValue(value, pathName);
}

function projectNode(node, pathName) {
  if (!PROBE_NODE_KINDS.has(node.type) || NODE_SCHEMAS[node.type] === undefined) {
    throw new TypeError(`${pathName}: node kind ${node.type} is outside the probe`);
  }
  const properties = [];
  for (const [name, value] of Object.entries(node.props ?? {}).sort(([left], [right]) => compareCodePoints(left, right))) {
    const schema = NODE_SCHEMAS[node.type]?.props?.[name];
    if (schema === undefined) throw new TypeError(`${pathName}: property ${name} is outside the ${node.type} probe schema`);
    const isExpression = (schema.kind === 'expression' || (node.type === 'capability' && name === 'input')) &&
      typeof value === 'string' && value !== '';
    if ((schema.kind === 'rawExpr' || schema.kind === 'rawBlock') && !isExpression) {
      throw new TypeError(`${pathName}.${name}: ${schema.kind} payload is outside portable semantic KIR`);
    }
    properties.push({
      key: name,
      value: isExpression
        ? projectExpression(parseExpression(value), `${pathName}.${name}`)
        : propertyValue(value, schema, `${pathName}.${name}`),
    });
  }
  return {
    kind: node.type,
    location: location(node.loc),
    properties,
    children: (node.children ?? []).map((child, index) => projectNode(child, `${pathName}.children[${index}]`)),
  };
}

function normalizeId(id) {
  const portable = id.replaceAll('\\', '/');
  if (/^[A-Za-z]:/u.test(portable)) throw new TypeError(`module id ${JSON.stringify(id)} is drive-qualified`);
  const normalized = path.posix.normalize(portable.replace(/^\.\//u, ''));
  if (normalized === '.' || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError(`module id ${JSON.stringify(id)} is outside the probe root`);
  }
  return normalized;
}

function resolveTarget(moduleId, specifier, ids) {
  const base = path.posix.dirname(moduleId);
  const candidate = normalizeId(path.posix.join(base, specifier));
  const candidates = [candidate, `${candidate}.kern`];
  const target = candidates.find((item) => ids.has(item));
  if (target === undefined) throw new TypeError(`${moduleId}: missing import target ${specifier}`);
  return target;
}

function declarationExports(root) {
  return (root.children ?? [])
    .filter((node) =>
      node.type === 'fn' &&
      typeof node.props?.name === 'string' &&
      (node.props.export === true || node.props.export === 'true'))
    .map((node) => ({ name: node.props.name, kind: node.type, source: null }));
}

function declarationNames(root, moduleId) {
  const names = new Set();
  for (const node of root.children ?? []) {
    if (node.type !== 'fn' || typeof node.props?.name !== 'string') continue;
    if (names.has(node.props.name)) throw new TypeError(`${moduleId}: duplicate local declaration ${node.props.name}`);
    names.add(node.props.name);
  }
  return names;
}

function assertAcyclic(graph) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id, trail) {
    if (visiting.has(id)) throw new TypeError(`module cycle: ${[...trail, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of graph.get(id) ?? []) visit(target, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of [...graph.keys()].sort(compareCodePoints)) visit(id, []);
}

export function projectModules(inputs) {
  const normalized = inputs.map((input) => ({ id: normalizeId(input.id), source: input.source }));
  const ids = new Set(normalized.map((input) => input.id));
  if (ids.size !== normalized.length) throw new TypeError('duplicate module id');
  const parsed = normalized.map((input) => ({ ...input, ...parseDocumentWithDiagnostics(input.source) }));
  for (const module of parsed) {
    if (module.diagnostics.length > 0) {
      const first = module.diagnostics[0];
      throw new TypeError(`${module.id}: parser diagnostic ${first.code} at ${first.line}:${first.col}: ${first.message}`);
    }
  }
  const exportSets = new Map(parsed.map((module) => [module.id, declarationExports(module.root)]));
  const graph = new Map();
  const modules = [];

  for (const module of parsed) {
    const importsBySource = new Map();
    const exports = [];
    const exportedNames = new Set();
    for (const item of exportSets.get(module.id)) {
      if (exportedNames.has(item.name)) throw new TypeError(`${module.id}: duplicate local declaration export ${item.name}`);
      exportedNames.add(item.name);
      exports.push(item);
    }
    const localBindings = declarationNames(module.root, module.id);
    const targets = [];
    for (const use of (module.root.children ?? []).filter((node) => node.type === 'use')) {
      const target = resolveTarget(module.id, use.props.path, ids);
      targets.push(target);
      let importedModule = importsBySource.get(target);
      if (importedModule === undefined) {
        importedModule = { source: target, bindings: [] };
        importsBySource.set(target, importedModule);
      }
      for (const binding of use.children ?? []) {
        if (binding.type !== 'from') throw new TypeError(`${module.id}: use child ${binding.type} is outside the probe`);
        const imported = binding.props.name;
        const targetExport = exportSets.get(target).find((item) => item.name === imported);
        if (targetExport === undefined) {
          throw new TypeError(`${module.id}: missing export ${imported} from ${target}`);
        }
        const bindingKind = binding.props.kind ?? targetExport.kind;
        if (bindingKind !== targetExport.kind) {
          throw new TypeError(`${module.id}: import ${imported} from ${target} expected kind ${bindingKind} but found ${targetExport.kind}`);
        }
        const reexport = binding.props.export === true || binding.props.export === 'true';
        const local = binding.props.as ?? imported;
        if (localBindings.has(local)) throw new TypeError(`${module.id}: duplicate local import binding ${local}`);
        localBindings.add(local);
        if (reexport) {
          if (exportedNames.has(local)) throw new TypeError(`${module.id}: duplicate export ${local}`);
          exportedNames.add(local);
          exports.push({ name: local, kind: targetExport.kind, source: target });
        }
        importedModule.bindings.push({ imported, local, kind: targetExport.kind, reexport });
      }
    }
    const imports = [...importsBySource.values()]
      .map((item) => ({ ...item, bindings: item.bindings.sort((left, right) => compareCodePoints(
        [left.imported, left.local, left.kind, left.reexport ? '1' : '0'].join('\0'),
        [right.imported, right.local, right.kind, right.reexport ? '1' : '0'].join('\0'),
      )) }))
      .sort((left, right) => compareCodePoints(left.source, right.source));
    graph.set(module.id, targets);
    modules.push({
      id: module.id,
      imports,
      exports: exports.sort((left, right) => compareCodePoints(left.name, right.name)),
      nodes: (module.root.children ?? []).filter((node) => node.type !== 'use').map((node, index) => projectNode(node, `${module.id}.nodes[${index}]`)),
    });
  }
  assertAcyclic(graph);
  modules.sort((left, right) => compareCodePoints(left.id, right.id));
  return { format: PROBE_FORMAT, modules, diagnostics: [] };
}
