import type { CanonicalValue } from '../../canonical-value/types.js';
import { KernKirFault, type KernKirValue } from '../contracts.js';
import { canonicalRecord, denseArray, exact, plainRecord, type RuntimeMeter } from '../inspect.js';
import {
  LINKED_KIR_BINARY_OPERATORS,
  type LinkedKernKirExpression,
  type LinkedKernKirStaticType,
  type LinkedKernKirTypeScope,
  linkedKirBinaryOperator,
} from './contracts.js';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const CANONICAL_INTEGER = /^(?:0|[1-9][0-9]*)$/u;

function unsupported(message: string): never {
  throw new KernKirFault('handler-entry-unsupported', 'link', message);
}

function canonicalText(value: CanonicalValue | undefined, label: string, meter: RuntimeMeter): string {
  if (value === undefined) unsupported(`${label}: missing text`);
  const record = plainRecord(value, label);
  exact(record, ['tag', 'value'], label);
  if (record.tag !== 'text' || typeof record.value !== 'string') unsupported(`${label}: expected text`);
  return meter.text(record.value, label);
}

function canonicalBool(value: CanonicalValue | undefined, label: string): boolean {
  if (value === undefined) unsupported(`${label}: missing boolean`);
  const record = plainRecord(value, label);
  exact(record, ['tag', 'value'], label);
  if (record.tag !== 'bool' || typeof record.value !== 'boolean') unsupported(`${label}: expected boolean`);
  return record.value;
}

function canonicalScalar(
  value: CanonicalValue | undefined,
  tag: 'int' | 'decimal',
  label: string,
  meter: RuntimeMeter,
): string {
  if (value === undefined) unsupported(`${label}: missing scalar`);
  const record = plainRecord(value, label);
  exact(record, ['tag', 'value'], label);
  if (record.tag !== tag || typeof record.value !== 'string') unsupported(`${label}: expected ${tag}`);
  return meter.text(record.value, label);
}

function canonicalList(
  value: CanonicalValue | undefined,
  label: string,
  meter: RuntimeMeter,
): readonly CanonicalValue[] {
  if (value === undefined) unsupported(`${label}: missing list`);
  const record = plainRecord(value, label);
  exact(record, ['tag', 'value'], label);
  if (record.tag !== 'list') unsupported(`${label}: expected list`);
  const result = denseArray(record.value, `${label}.value`) as readonly CanonicalValue[];
  meter.collection(result.length, label);
  return result;
}

function literal(value: KernKirValue): LinkedKernKirExpression {
  return Object.freeze({ kind: 'literal', value });
}

export function staticExpressionType(
  expression: LinkedKernKirExpression,
  scope: LinkedKernKirTypeScope,
): LinkedKernKirStaticType | undefined {
  if (expression.kind === 'binary') return 'boolean';
  if (expression.kind === 'identifier') return scope.types.get(expression.name);
  if (expression.kind !== 'literal') return undefined;
  if (expression.value.tag === 'boolean') return 'boolean';
  if (expression.value.tag === 'integer' && CANONICAL_INTEGER.test(expression.value.value)) return 'integer';
  return undefined;
}

export function compileLinkedExpression(
  value: CanonicalValue,
  scope: LinkedKernKirTypeScope,
  meter: RuntimeMeter,
  label: string,
  depth = 1,
  context: 'value' | 'intrinsic-member' | 'intrinsic-object' = 'value',
): LinkedKernKirExpression {
  meter.step();
  if (depth > meter.limits.maxDepth) throw new KernKirFault('runtime-limit-exceeded', 'execution', `${label}: depth`);
  const expression = canonicalRecord(value, ['fields', 'kind'], label);
  const kind = canonicalText(expression.get('kind'), `${label}.kind`, meter);
  const fields = expression.get('fields');
  if (fields === undefined) unsupported(`${label}.fields: missing record`);
  if (kind === 'null') {
    canonicalRecord(fields, [], `${label}.fields`);
    return literal(Object.freeze({ tag: 'null' }));
  }
  if (kind === 'identifier') {
    const values = canonicalRecord(fields, ['name'], `${label}.fields`);
    const name = canonicalText(values.get('name'), `${label}.fields.name`, meter);
    if (!IDENTIFIER.test(name) || (!scope.bindings.has(name) && !(name === 'Json' && context === 'intrinsic-object'))) {
      unsupported(`${label}: unknown identifier ${name}`);
    }
    return Object.freeze({ kind: 'identifier', name });
  }
  if (kind === 'boolean') {
    const values = canonicalRecord(fields, ['value'], `${label}.fields`);
    return literal(
      Object.freeze({ tag: 'boolean', value: canonicalBool(values.get('value'), `${label}.fields.value`) }),
    );
  }
  if (kind === 'text') {
    const values = canonicalRecord(fields, ['value'], `${label}.fields`);
    return literal(
      Object.freeze({ tag: 'text', value: canonicalText(values.get('value'), `${label}.fields.value`, meter) }),
    );
  }
  if (kind === 'integer' || kind === 'decimal') {
    const values = canonicalRecord(fields, ['value'], `${label}.fields`);
    return literal(
      Object.freeze({
        tag: kind,
        value: canonicalScalar(
          values.get('value'),
          kind === 'integer' ? 'int' : 'decimal',
          `${label}.fields.value`,
          meter,
        ),
      }),
    );
  }
  if (kind === 'list') {
    const values = canonicalRecord(fields, ['items'], `${label}.fields`);
    const items = canonicalList(values.get('items'), `${label}.fields.items`, meter);
    return Object.freeze({
      kind: 'list',
      items: Object.freeze(
        items.map((item, index) => compileLinkedExpression(item, scope, meter, `${label}.items[${index}]`, depth + 1)),
      ),
    });
  }
  if (kind === 'record') {
    const values = canonicalRecord(fields, ['entries'], `${label}.fields`);
    const entriesValue = values.get('entries');
    if (entriesValue === undefined) unsupported(`${label}.fields.entries: missing record`);
    const entriesRecord = plainRecord(entriesValue, `${label}.fields.entries`);
    exact(entriesRecord, ['tag', 'value'], `${label}.fields.entries`);
    if (entriesRecord.tag !== 'record') unsupported(`${label}.fields.entries: expected record`);
    const entries = denseArray(entriesRecord.value, `${label}.fields.entries.value`);
    meter.collection(entries.length, `${label}.fields.entries`);
    return Object.freeze({
      kind: 'record',
      entries: Object.freeze(
        entries.map((entry, index) => {
          const item = plainRecord(entry, `${label}.entries[${index}]`);
          exact(item, ['key', 'value'], `${label}.entries[${index}]`);
          if (typeof item.key !== 'string') unsupported(`${label}.entries[${index}].key`);
          meter.text(item.key, `${label}.entries[${index}].key`);
          return Object.freeze({
            key: item.key,
            value: compileLinkedExpression(
              item.value as CanonicalValue,
              scope,
              meter,
              `${label}.entries.${item.key}`,
              depth + 1,
            ),
          });
        }),
      ),
    });
  }
  if (kind === 'member') {
    const values = canonicalRecord(fields, ['object', 'optional', 'property'], `${label}.fields`);
    const objectValue = values.get('object');
    if (objectValue === undefined) unsupported(`${label}.fields.object`);
    const property = canonicalText(values.get('property'), `${label}.fields.property`, meter);
    if (!IDENTIFIER.test(property)) unsupported(`${label}.fields.property: invalid identifier`);
    const object = compileLinkedExpression(
      objectValue,
      scope,
      meter,
      `${label}.fields.object`,
      depth + 1,
      context === 'intrinsic-member' ? 'intrinsic-object' : 'value',
    );
    if (object.kind === 'identifier' && object.name === 'Json' && context !== 'intrinsic-member') {
      unsupported(`${label}: intrinsic member position`);
    }
    return Object.freeze({
      kind: 'member',
      object,
      optional: canonicalBool(values.get('optional'), `${label}.fields.optional`),
      property,
    });
  }
  if (kind === 'binary') {
    const values = canonicalRecord(fields, ['left', 'op', 'right'], `${label}.fields`);
    const op = linkedKirBinaryOperator(canonicalText(values.get('op'), `${label}.fields.op`, meter));
    if (op === undefined) unsupported(`${label}: KIR_BINARY_OP_UNSUPPORTED`);
    const leftValue = values.get('left');
    const rightValue = values.get('right');
    if (leftValue === undefined || rightValue === undefined) unsupported(`${label}.fields: missing operand`);
    const left = compileLinkedExpression(leftValue, scope, meter, `${label}.left`, depth + 1);
    const right = compileLinkedExpression(rightValue, scope, meter, `${label}.right`, depth + 1);
    const operand = staticExpressionType(left, scope);
    const { operandType } = LINKED_KIR_BINARY_OPERATORS[op];
    if (operand === undefined || operand !== staticExpressionType(right, scope)) {
      unsupported(`${label}: KIR_BINARY_OPERAND_TYPE`);
    }
    if (operandType !== 'either' && operand !== operandType) {
      unsupported(`${label}: KIR_BINARY_OPERAND_TYPE`);
    }
    return Object.freeze({ kind: 'binary', left, op, right });
  }
  if (kind === 'call') {
    const values = canonicalRecord(fields, ['args', 'callee', 'optional'], `${label}.fields`);
    if (canonicalBool(values.get('optional'), `${label}.fields.optional`)) unsupported(`${label}: optional call`);
    const args = canonicalList(values.get('args'), `${label}.fields.args`, meter);
    if (args.length !== 1) unsupported(`${label}: intrinsic arity`);
    const calleeValue = values.get('callee');
    if (calleeValue === undefined) unsupported(`${label}.fields.callee`);
    const callee = compileLinkedExpression(
      calleeValue,
      scope,
      meter,
      `${label}.fields.callee`,
      depth + 1,
      'intrinsic-member',
    );
    if (
      callee.kind !== 'member' ||
      callee.optional ||
      callee.object.kind !== 'identifier' ||
      callee.object.name !== 'Json' ||
      (callee.property !== 'parse' && callee.property !== 'stringify')
    ) {
      unsupported(`${label}: unsupported intrinsic`);
    }
    return Object.freeze({
      kind: 'json-call',
      operation: callee.property,
      argument: compileLinkedExpression(args[0], scope, meter, `${label}.fields.args[0]`, depth + 1),
    });
  }
  unsupported(`${label}: unsupported expression kind ${kind}`);
}
