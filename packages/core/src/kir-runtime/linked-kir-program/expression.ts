import type { CanonicalValue } from '../../canonical-value/types.js';
import { KernKirFault, type KernKirValue } from '../contracts.js';
import { canonicalRecord, denseArray, exact, plainRecord, type RuntimeMeter } from '../inspect.js';
import type { LinkedKernKirExpression } from './contracts.js';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

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

export function compileLinkedExpression(
  value: CanonicalValue,
  bindings: ReadonlySet<string>,
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
    if (!IDENTIFIER.test(name) || (!bindings.has(name) && !(name === 'Json' && context === 'intrinsic-object'))) {
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
        items.map((item, index) =>
          compileLinkedExpression(item, bindings, meter, `${label}.items[${index}]`, depth + 1),
        ),
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
              bindings,
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
      bindings,
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
  if (kind === 'call') {
    const values = canonicalRecord(fields, ['args', 'callee', 'optional'], `${label}.fields`);
    if (canonicalBool(values.get('optional'), `${label}.fields.optional`)) unsupported(`${label}: optional call`);
    const args = canonicalList(values.get('args'), `${label}.fields.args`, meter);
    if (args.length !== 1) unsupported(`${label}: intrinsic arity`);
    const calleeValue = values.get('callee');
    if (calleeValue === undefined) unsupported(`${label}.fields.callee`);
    const callee = compileLinkedExpression(
      calleeValue,
      bindings,
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
      argument: compileLinkedExpression(args[0], bindings, meter, `${label}.fields.args[0]`, depth + 1),
    });
  }
  unsupported(`${label}: unsupported expression kind ${kind}`);
}
