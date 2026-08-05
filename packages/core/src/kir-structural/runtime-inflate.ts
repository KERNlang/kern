import type { CanonicalValue } from '../canonical-value/types.js';
import type { PortableHandlerTypePosition } from '../portable-handler-type.js';
import type { IRNode } from '../types.js';
import { STRUCTURAL_KIR_NODE_CATALOG } from './catalog.generated.js';
import { validateHandlerType } from './handler-type.js';
import { StructuralKirError, type StructuralKirNode } from './types.js';

function fail(path: string, message: string): never {
  throw new StructuralKirError('invalid-artifact', path, message);
}

function exactRecord(value: CanonicalValue, keys: readonly string[], path: string): Map<string, CanonicalValue> {
  if (
    value.tag !== 'record' ||
    value.value.length !== keys.length ||
    value.value.some((entry, index) => entry.key !== keys[index])
  ) {
    fail(path, `expected canonical fields ${keys.join(',')}`);
  }
  return new Map(value.value.map((entry) => [entry.key, entry.value]));
}

function field(record: ReadonlyMap<string, CanonicalValue>, key: string, path: string): CanonicalValue {
  const value = record.get(key);
  if (value === undefined) fail(`${path}.${key}`, `missing ${key}`);
  return value;
}

function text(value: CanonicalValue, path: string): string {
  if (value.tag !== 'text') fail(path, 'expected text');
  return value.value;
}

function bool(value: CanonicalValue, path: string): boolean {
  if (value.tag !== 'bool') fail(path, 'expected boolean');
  return value.value;
}

function list(value: CanonicalValue, path: string): readonly CanonicalValue[] {
  if (value.tag !== 'list') fail(path, 'expected list');
  return value.value;
}

function renderExpression(value: CanonicalValue, path: string): string {
  const expression = exactRecord(value, ['fields', 'kind'], path);
  const kind = text(field(expression, 'kind', path), `${path}.kind`);
  const fields = field(expression, 'fields', path);
  if (kind === 'null') {
    exactRecord(fields, [], `${path}.fields`);
    return 'null';
  }
  if (kind === 'identifier') {
    const values = exactRecord(fields, ['name'], `${path}.fields`);
    return text(field(values, 'name', `${path}.fields`), `${path}.fields.name`);
  }
  if (kind === 'boolean' || kind === 'text' || kind === 'integer' || kind === 'decimal') {
    const values = exactRecord(fields, ['value'], `${path}.fields`);
    const scalar = field(values, 'value', `${path}.fields`);
    if (kind === 'boolean') return bool(scalar, `${path}.fields.value`) ? 'true' : 'false';
    if (kind === 'text') return JSON.stringify(text(scalar, `${path}.fields.value`));
    if (scalar.tag !== (kind === 'integer' ? 'int' : 'decimal')) {
      fail(`${path}.fields.value`, `expected ${kind}`);
    }
    return scalar.value;
  }
  if (kind === 'list') {
    const values = exactRecord(fields, ['items'], `${path}.fields`);
    return `[${list(field(values, 'items', `${path}.fields`), `${path}.fields.items`)
      .map((item, index) => renderExpression(item, `${path}.fields.items[${index}]`))
      .join(',')}]`;
  }
  if (kind === 'record') {
    const values = exactRecord(fields, ['entries'], `${path}.fields`);
    const entries = field(values, 'entries', `${path}.fields`);
    if (entries.tag !== 'record') fail(`${path}.fields.entries`, 'expected record entries');
    return `{${entries.value
      .map(
        (entry) =>
          `${JSON.stringify(entry.key)}:${renderExpression(entry.value, `${path}.fields.entries.${entry.key}`)}`,
      )
      .join(',')}}`;
  }
  if (kind === 'member') {
    const values = exactRecord(fields, ['object', 'optional', 'property'], `${path}.fields`);
    const object = renderExpression(field(values, 'object', `${path}.fields`), `${path}.fields.object`);
    const optional = bool(field(values, 'optional', `${path}.fields`), `${path}.fields.optional`);
    const property = text(field(values, 'property', `${path}.fields`), `${path}.fields.property`);
    return `(${object})${optional ? '?.' : '.'}${property}`;
  }
  if (kind === 'index') {
    const values = exactRecord(fields, ['index', 'object', 'optional'], `${path}.fields`);
    const object = renderExpression(field(values, 'object', `${path}.fields`), `${path}.fields.object`);
    const index = renderExpression(field(values, 'index', `${path}.fields`), `${path}.fields.index`);
    const optional = bool(field(values, 'optional', `${path}.fields`), `${path}.fields.optional`);
    return `(${object})${optional ? '?.' : ''}[${index}]`;
  }
  if (kind === 'call') {
    const values = exactRecord(fields, ['args', 'callee', 'optional'], `${path}.fields`);
    const callee = renderExpression(field(values, 'callee', `${path}.fields`), `${path}.fields.callee`);
    const args = list(field(values, 'args', `${path}.fields`), `${path}.fields.args`)
      .map((item, index) => renderExpression(item, `${path}.fields.args[${index}]`))
      .join(',');
    const optional = bool(field(values, 'optional', `${path}.fields`), `${path}.fields.optional`);
    return `(${callee})${optional ? '?.' : ''}(${args})`;
  }
  if (kind === 'new') {
    const values = exactRecord(fields, ['args', 'constructor'], `${path}.fields`);
    const constructorName = text(field(values, 'constructor', `${path}.fields`), `${path}.fields.constructor`);
    const args = list(field(values, 'args', `${path}.fields`), `${path}.fields.args`)
      .map((item, index) => renderExpression(item, `${path}.fields.args[${index}]`))
      .join(',');
    return `new ${constructorName}(${args})`;
  }
  if (kind === 'lambda') {
    const values = exactRecord(fields, ['body', 'params'], `${path}.fields`);
    const params = list(field(values, 'params', `${path}.fields`), `${path}.fields.params`)
      .map((item, index) => text(item, `${path}.fields.params[${index}]`))
      .join(',');
    const body = renderExpression(field(values, 'body', `${path}.fields`), `${path}.fields.body`);
    return `((${params})=>(${body}))`;
  }
  if (kind === 'binary') {
    const values = exactRecord(fields, ['left', 'op', 'right'], `${path}.fields`);
    const left = renderExpression(field(values, 'left', `${path}.fields`), `${path}.fields.left`);
    const op = text(field(values, 'op', `${path}.fields`), `${path}.fields.op`);
    const right = renderExpression(field(values, 'right', `${path}.fields`), `${path}.fields.right`);
    return `(${left} ${op} ${right})`;
  }
  if (kind === 'unary') {
    const values = exactRecord(fields, ['argument', 'op'], `${path}.fields`);
    const argument = renderExpression(field(values, 'argument', `${path}.fields`), `${path}.fields.argument`);
    const op = text(field(values, 'op', `${path}.fields`), `${path}.fields.op`);
    return `(${op === 'typeof' || op === 'void' ? `${op} ` : op}(${argument}))`;
  }
  if (kind === 'conditional') {
    const values = exactRecord(fields, ['alternate', 'consequent', 'test'], `${path}.fields`);
    const test = renderExpression(field(values, 'test', `${path}.fields`), `${path}.fields.test`);
    const consequent = renderExpression(field(values, 'consequent', `${path}.fields`), `${path}.fields.consequent`);
    const alternate = renderExpression(field(values, 'alternate', `${path}.fields`), `${path}.fields.alternate`);
    return `(${test} ? ${consequent} : ${alternate})`;
  }
  fail(`${path}.kind`, `unsupported expression kind ${kind}`);
}

function handlerTypePosition(kind: string, name: string, parentKind: string | undefined): PortableHandlerTypePosition {
  if (kind === 'fn' && name === 'returns') return 'return';
  if (kind === 'param' && name === 'type' && parentKind === 'fn') return 'parameter';
  fail(`$.${kind}.properties.${name}`, 'type is outside a structured handler signature');
}

function renderHandlerType(value: CanonicalValue, position: PortableHandlerTypePosition, path: string): string {
  const type = validateHandlerType(value, position, path);
  const scalar = (kind: 'boolean' | 'integer' | 'text'): string =>
    kind === 'integer' ? 'number' : kind === 'text' ? 'string' : 'boolean';
  if (type.kind === 'list') return `${scalar(type.element)}[]`;
  if (type.kind === 'void') return 'void';
  return scalar(type.kind);
}

function inflateProperty(
  node: StructuralKirNode,
  key: string,
  value: CanonicalValue,
  path: string,
  parentKind: string | undefined,
): unknown {
  const contract = STRUCTURAL_KIR_NODE_CATALOG.get(node.kind)?.properties[key];
  if (!contract) fail(path, `property ${key} is absent from the structural constitution`);
  if (contract.disposition === 'lowered-expression') return renderExpression(value, path);
  if (contract.disposition === 'lowered-type') {
    return renderHandlerType(value, handlerTypePosition(node.kind, key, parentKind), path);
  }
  if (contract.disposition === 'lowered-import-path' || contract.disposition === 'included-value') {
    if (value.tag === 'bool') return value.value;
    if (value.tag === 'text' || value.tag === 'int' || value.tag === 'decimal') return value.value;
  }
  fail(path, `property disposition ${contract.disposition} is not executable`);
}

export function inflateStructuralKirNode(node: StructuralKirNode, path = '$.root', parentKind?: string): IRNode {
  const props: Record<string, unknown> = {};
  for (const entry of node.properties) {
    props[entry.key] = inflateProperty(node, entry.key, entry.value, `${path}.properties.${entry.key}`, parentKind);
  }
  return {
    type: node.kind,
    ...(node.children.length === 0
      ? {}
      : {
          children: node.children.map((child, index) =>
            inflateStructuralKirNode(child, `${path}.children[${index}]`, node.kind),
          ),
        }),
    ...(Object.keys(props).length === 0 ? {} : { props }),
  };
}
