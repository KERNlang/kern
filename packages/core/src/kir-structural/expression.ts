import type { CanonicalRecordEntry, CanonicalValue } from '../canonical-value/types.js';
import { compareCodePoints } from '../canonical-value/validate.js';
import { parseExpression } from '../parser-expression.js';
import type { ValueIR } from '../value-ir.js';
import { StructuralKirError } from './types.js';

const EXPRESSION_KINDS = new Set([
  'identifier',
  'null',
  'boolean',
  'integer',
  'decimal',
  'text',
  'list',
  'record',
  'member',
  'index',
  'call',
  'new',
  'lambda',
  'binary',
  'unary',
  'conditional',
]);
const BINARY_OPERATORS = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '==',
  '!=',
  '===',
  '!==',
  '<',
  '<=',
  '>',
  '>=',
  'instanceof',
  '&&',
  '||',
  '??',
  '&',
  '|',
  '^',
  '<<',
  '>>',
  '>>>',
]);
const UNARY_OPERATORS = new Set(['!', '-', '+', '~', 'typeof', 'void']);
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

function fail(code: ConstructorParameters<typeof StructuralKirError>[0], path: string, message: string): never {
  throw new StructuralKirError(code, path, message);
}

function record(fields: Readonly<Record<string, CanonicalValue>>): CanonicalValue {
  return {
    tag: 'record',
    value: Object.entries(fields)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, value]) => ({ key, value })),
  };
}

function expression(kind: string, fields: Readonly<Record<string, CanonicalValue>>): CanonicalValue {
  return record({ fields: record(fields), kind: { tag: 'text', value: kind } });
}

function projectNumber(node: Extract<ValueIR, { kind: 'numLit' }>, path: string): CanonicalValue {
  if (node.bigint === true || Object.is(node.value, -0) || node.raw === '-0') {
    fail('invalid-expression', path, 'bigint and negative zero are outside the expression catalog');
  }
  if (/^(?:0|-?[1-9][0-9]*)$/u.test(node.raw)) {
    return expression('integer', { value: { tag: 'int', value: node.raw } });
  }
  if (/^-?(?:0|[1-9][0-9]*)\.[0-9]+$/u.test(node.raw)) {
    return expression('decimal', { value: { tag: 'decimal', value: node.raw } });
  }
  fail('invalid-expression', path, 'numeric literal is not canonical integer or decimal text');
}

function projectRecord(node: Extract<ValueIR, { kind: 'objectLit' }>, path: string): CanonicalValue {
  const fields: Record<string, CanonicalValue> = Object.create(null) as Record<string, CanonicalValue>;
  for (let index = 0; index < node.entries.length; index += 1) {
    const entry = node.entries[index];
    if ('kind' in entry)
      fail('invalid-expression', `${path}.entries[${index}]`, 'record spread is outside the catalog');
    if (Object.hasOwn(fields, entry.key)) {
      fail('invalid-expression', `${path}.entries[${index}]`, `duplicate record key ${entry.key}`);
    }
    fields[entry.key] = projectValueIr(entry.value, `${path}.entries[${index}].value`);
  }
  return expression('record', { entries: record(fields) });
}

function projectLambda(node: Extract<ValueIR, { kind: 'lambda' }>, path: string): CanonicalValue {
  if (node.body === undefined || node.bodyBlock !== undefined || node.returnType !== undefined) {
    fail('invalid-expression', path, 'typed or block-bodied lambda is outside the catalog');
  }
  const params = node.params.map((param, index) => {
    if (param.type !== undefined || !IDENTIFIER.test(param.name)) {
      fail('invalid-expression', `${path}.params[${index}]`, 'lambda parameter must be an untyped identifier');
    }
    return { tag: 'text', value: param.name } as const;
  });
  return expression('lambda', {
    body: projectValueIr(node.body, `${path}.body`),
    params: { tag: 'list', value: params },
  });
}

function boundedConstructorArity(name: string): 0 | 1 | -1 {
  return name === 'Map' ? 0 : name === 'Error' ? 1 : -1;
}

function projectNew(node: Extract<ValueIR, { kind: 'new' }>, path: string): CanonicalValue {
  const call = node.argument;
  if (call.kind !== 'call' || call.optional || call.typeArgs !== undefined || call.callee.kind !== 'ident') {
    fail('invalid-expression', path, 'constructor must be a non-optional untyped call of a bare identifier');
  }
  const constructorName = call.callee.name;
  const expectedArity = boundedConstructorArity(constructorName);
  if (expectedArity < 0) {
    fail('invalid-expression', `${path}.constructor`, `unsupported constructor ${constructorName}`);
  }
  if (call.args.length !== expectedArity || call.args.some((argument) => argument.kind === 'spread')) {
    fail(
      'invalid-expression',
      `${path}.args`,
      `${constructorName} constructor expects exactly ${expectedArity} arguments`,
    );
  }
  const fields = Object.create(null) as Record<string, CanonicalValue>;
  fields.args = {
    tag: 'list',
    value: call.args.map((argument, index) => projectValueIr(argument, `${path}.args[${index}]`)),
  };
  Reflect.set(fields, 'constructor', { tag: 'text', value: constructorName } satisfies CanonicalValue);
  return expression('new', fields);
}

function projectValueIr(node: ValueIR, path: string): CanonicalValue {
  switch (node.kind) {
    case 'numLit':
      return projectNumber(node, path);
    case 'strLit':
      return expression('text', { value: { tag: 'text', value: node.value } });
    case 'boolLit':
      return expression('boolean', { value: { tag: 'bool', value: node.value } });
    case 'nullLit':
      return expression('null', {});
    case 'ident':
      if (!IDENTIFIER.test(node.name)) fail('invalid-expression', `${path}.name`, 'invalid identifier');
      return expression('identifier', { name: { tag: 'text', value: node.name } });
    case 'arrayLit':
      return expression('list', {
        items: { tag: 'list', value: node.items.map((item, index) => projectValueIr(item, `${path}.items[${index}]`)) },
      });
    case 'objectLit':
      return projectRecord(node, path);
    case 'member':
      if (!IDENTIFIER.test(node.property)) fail('invalid-expression', `${path}.property`, 'invalid member identifier');
      return expression('member', {
        object: projectValueIr(node.object, `${path}.object`),
        optional: { tag: 'bool', value: node.optional },
        property: { tag: 'text', value: node.property },
      });
    case 'index':
      return expression('index', {
        index: projectValueIr(node.index, `${path}.index`),
        object: projectValueIr(node.object, `${path}.object`),
        optional: { tag: 'bool', value: node.optional },
      });
    case 'call':
      if (node.typeArgs !== undefined) fail('invalid-expression', path, 'typed call is outside the catalog');
      return expression('call', {
        args: { tag: 'list', value: node.args.map((arg, index) => projectValueIr(arg, `${path}.args[${index}]`)) },
        callee: projectValueIr(node.callee, `${path}.callee`),
        optional: { tag: 'bool', value: node.optional },
      });
    case 'new':
      return projectNew(node, path);
    case 'lambda':
      return projectLambda(node, path);
    case 'binary':
      if (!BINARY_OPERATORS.has(node.op)) fail('invalid-expression', `${path}.op`, 'unknown binary operator');
      return expression('binary', {
        left: projectValueIr(node.left, `${path}.left`),
        op: { tag: 'text', value: node.op },
        right: projectValueIr(node.right, `${path}.right`),
      });
    case 'unary':
      if (!UNARY_OPERATORS.has(node.op)) fail('invalid-expression', `${path}.op`, 'unknown unary operator');
      if (node.op === '-' && node.argument.kind === 'numLit' && node.argument.value === 0) {
        fail('invalid-expression', path, 'negative zero is outside the expression catalog');
      }
      return expression('unary', {
        argument: projectValueIr(node.argument, `${path}.argument`),
        op: { tag: 'text', value: node.op },
      });
    case 'conditional':
      return expression('conditional', {
        alternate: projectValueIr(node.alternate, `${path}.alternate`),
        consequent: projectValueIr(node.consequent, `${path}.consequent`),
        test: projectValueIr(node.test, `${path}.test`),
      });
    default:
      fail('unknown-expression-kind', path, `${node.kind} is outside the expression catalog`);
  }
}

export function projectExpressionText(source: string, path: string): CanonicalValue {
  if (source.trim() === '-0') fail('invalid-expression', path, 'negative zero is outside the expression catalog');
  let parsed: ValueIR;
  try {
    parsed = parseExpression(source);
  } catch {
    fail('invalid-expression', path, 'expression cannot be parsed by the portable parser');
  }
  return projectValueIr(parsed, path);
}

function asRecord(value: CanonicalValue, path: string): readonly CanonicalRecordEntry[] {
  if (value.tag !== 'record') fail('invalid-expression', path, 'expected expression record');
  return value.value;
}

function exactRecord(value: CanonicalValue, keys: readonly string[], path: string): Map<string, CanonicalValue> {
  const entries = asRecord(value, path);
  if (entries.length !== keys.length || entries.some((entry, index) => entry.key !== keys[index])) {
    fail('invalid-expression', path, `expected expression fields ${keys.join(',')}`);
  }
  return new Map(entries.map((entry) => [entry.key, entry.value]));
}

function field(recordValue: Map<string, CanonicalValue>, key: string): CanonicalValue {
  const value = recordValue.get(key);
  if (value === undefined) fail('invalid-expression', `$.${key}`, `missing expression field ${key}`);
  return value;
}

function text(value: CanonicalValue, path: string): string {
  if (value.tag !== 'text') fail('invalid-expression', path, 'expected text');
  return value.value;
}

function bool(value: CanonicalValue, path: string): void {
  if (value.tag !== 'bool') fail('invalid-expression', path, 'expected boolean');
}

function nested(value: CanonicalValue, path: string): void {
  validateExpressionValue(value, path);
}

function nestedList(value: CanonicalValue, path: string): void {
  if (value.tag !== 'list') fail('invalid-expression', path, 'expected expression list');
  value.value.forEach((item, index) => nested(item, `${path}[${index}]`));
}

function isZeroNumberExpression(value: CanonicalValue): boolean {
  const expressionRecord = exactRecord(value, ['fields', 'kind'], '$.expression');
  const kind = text(field(expressionRecord, 'kind'), '$.expression.kind');
  if (kind !== 'integer' && kind !== 'decimal') return false;
  const fields = exactRecord(field(expressionRecord, 'fields'), ['value'], '$.expression.fields');
  const number = field(fields, 'value');
  if (kind === 'integer') return number.tag === 'int' && number.value === '0';
  return number.tag === 'decimal' && /^0\.0+$/u.test(number.value);
}

function validateFields(kind: string, fields: CanonicalValue, path: string): void {
  if (kind === 'null') {
    exactRecord(fields, [], path);
    return;
  }
  if (kind === 'identifier') {
    const values = exactRecord(fields, ['name'], path);
    if (!IDENTIFIER.test(text(field(values, 'name'), `${path}.name`)))
      fail('invalid-expression', `${path}.name`, 'invalid identifier');
    return;
  }
  if (kind === 'boolean' || kind === 'text' || kind === 'integer' || kind === 'decimal') {
    const values = exactRecord(fields, ['value'], path);
    const value = field(values, 'value');
    if (kind === 'boolean') bool(value, `${path}.value`);
    else if (kind === 'text') text(value, `${path}.value`);
    else if (value.tag !== (kind === 'integer' ? 'int' : 'decimal'))
      fail('invalid-expression', `${path}.value`, `expected ${kind}`);
    return;
  }
  if (kind === 'list') {
    const values = exactRecord(fields, ['items'], path);
    nestedList(field(values, 'items'), `${path}.items`);
    return;
  }
  if (kind === 'record') {
    const values = exactRecord(fields, ['entries'], path);
    asRecord(field(values, 'entries'), `${path}.entries`).forEach((entry) =>
      nested(entry.value, `${path}.entries.${entry.key}`),
    );
    return;
  }
  if (kind === 'member') {
    const values = exactRecord(fields, ['object', 'optional', 'property'], path);
    nested(field(values, 'object'), `${path}.object`);
    bool(field(values, 'optional'), `${path}.optional`);
    if (!IDENTIFIER.test(text(field(values, 'property'), `${path}.property`)))
      fail('invalid-expression', `${path}.property`, 'invalid member identifier');
    return;
  }
  if (kind === 'index') {
    const values = exactRecord(fields, ['index', 'object', 'optional'], path);
    nested(field(values, 'index'), `${path}.index`);
    nested(field(values, 'object'), `${path}.object`);
    bool(field(values, 'optional'), `${path}.optional`);
    return;
  }
  if (kind === 'call') {
    const values = exactRecord(fields, ['args', 'callee', 'optional'], path);
    nestedList(field(values, 'args'), `${path}.args`);
    nested(field(values, 'callee'), `${path}.callee`);
    bool(field(values, 'optional'), `${path}.optional`);
    return;
  }
  if (kind === 'new') {
    const values = exactRecord(fields, ['args', 'constructor'], path);
    const args = field(values, 'args');
    if (args.tag !== 'list') fail('invalid-expression', `${path}.args`, 'expected expression list');
    const constructorName = text(field(values, 'constructor'), `${path}.constructor`);
    const expectedArity = boundedConstructorArity(constructorName);
    if (expectedArity < 0)
      fail('invalid-expression', `${path}.constructor`, `unsupported constructor ${constructorName}`);
    if (args.value.length !== expectedArity) {
      fail(
        'invalid-expression',
        `${path}.args`,
        `${constructorName} constructor expects exactly ${expectedArity} arguments`,
      );
    }
    args.value.forEach((argument, index) => nested(argument, `${path}.args[${index}]`));
    return;
  }
  if (kind === 'lambda') {
    const values = exactRecord(fields, ['body', 'params'], path);
    nested(field(values, 'body'), `${path}.body`);
    const params = field(values, 'params');
    if (params.tag !== 'list') fail('invalid-expression', `${path}.params`, 'expected parameter list');
    params.value.forEach((param, index) => {
      if (!IDENTIFIER.test(text(param, `${path}.params[${index}]`)))
        fail('invalid-expression', `${path}.params[${index}]`, 'invalid parameter');
    });
    return;
  }
  if (kind === 'binary') {
    const values = exactRecord(fields, ['left', 'op', 'right'], path);
    nested(field(values, 'left'), `${path}.left`);
    nested(field(values, 'right'), `${path}.right`);
    if (!BINARY_OPERATORS.has(text(field(values, 'op'), `${path}.op`)))
      fail('invalid-expression', `${path}.op`, 'unknown binary operator');
    return;
  }
  if (kind === 'unary') {
    const values = exactRecord(fields, ['argument', 'op'], path);
    const argument = field(values, 'argument');
    nested(argument, `${path}.argument`);
    const operator = text(field(values, 'op'), `${path}.op`);
    if (!UNARY_OPERATORS.has(operator)) fail('invalid-expression', `${path}.op`, 'unknown unary operator');
    if (operator === '-' && isZeroNumberExpression(argument)) {
      fail('invalid-expression', path, 'negative zero is outside the expression catalog');
    }
    return;
  }
  const values = exactRecord(fields, ['alternate', 'consequent', 'test'], path);
  nested(field(values, 'alternate'), `${path}.alternate`);
  nested(field(values, 'consequent'), `${path}.consequent`);
  nested(field(values, 'test'), `${path}.test`);
}

export function validateExpressionValue(value: CanonicalValue, path: string): void {
  const expressionRecord = exactRecord(value, ['fields', 'kind'], path);
  const kind = text(field(expressionRecord, 'kind'), `${path}.kind`);
  if (!EXPRESSION_KINDS.has(kind)) fail('unknown-expression-kind', `${path}.kind`, `unknown expression kind ${kind}`);
  validateFields(kind, field(expressionRecord, 'fields'), `${path}.fields`);
}
