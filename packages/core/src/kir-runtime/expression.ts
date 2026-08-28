import { KernKirFault, type KernKirValue } from './contracts.js';
import type { RuntimeMeter } from './inspect.js';
import { parseKernJson, stringifyKernJson } from './json.js';
import type { LinkedKernKirExpression } from './linked-kir-program/index.js';

export function evaluateExpression(
  expression: LinkedKernKirExpression,
  bindings: ReadonlyMap<string, KernKirValue>,
  meter: RuntimeMeter,
): KernKirValue {
  meter.step();
  switch (expression.kind) {
    case 'literal':
      return expression.value;
    case 'identifier': {
      const value = bindings.get(expression.name);
      if (value === undefined) {
        throw new KernKirFault('handler-link-error', 'execution', `missing binding ${expression.name}`);
      }
      return value;
    }
    case 'list':
      return Object.freeze({
        tag: 'list',
        value: Object.freeze(expression.items.map((item) => evaluateExpression(item, bindings, meter))),
      });
    case 'record':
      return Object.freeze({
        tag: 'record',
        value: Object.freeze(
          expression.entries.map((entry) =>
            Object.freeze({ key: entry.key, value: evaluateExpression(entry.value, bindings, meter) }),
          ),
        ),
      });
    case 'member': {
      const object = evaluateExpression(expression.object, bindings, meter);
      if (object.tag === 'null' && expression.optional) return Object.freeze({ tag: 'null' });
      if (object.tag !== 'record') {
        throw new KernKirFault('unsupported-runtime-input', 'execution', 'member object is not a record');
      }
      const value = object.value.find((entry) => entry.key === expression.property)?.value;
      if (value !== undefined) return value;
      if (expression.optional) return Object.freeze({ tag: 'null' });
      throw new KernKirFault('unsupported-runtime-input', 'execution', `missing member ${expression.property}`);
    }
    case 'json-call': {
      const argument = evaluateExpression(expression.argument, bindings, meter);
      if (expression.operation === 'parse') {
        if (argument.tag !== 'text') {
          throw new KernKirFault('unsupported-runtime-input', 'execution', 'Json.parse expects text');
        }
        return parseKernJson(argument.value, meter);
      }
      return Object.freeze({ tag: 'text', value: stringifyKernJson(argument, meter) });
    }
  }
}
