import {
  CORE_FIXTURE_FUNCTION,
  CORE_FIXTURE_UNDEFINED,
  type CoreFixtureValue,
  isCoreFixtureFunction,
  isCoreFixtureUndefined,
} from '../core-contracts/index.js';
import type { KernValue } from './index.js';
import { brandValue } from './value-brand.js';

export class CoreRuntimeContractAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreRuntimeContractAdapterError';
  }
}

export function kernValueToCoreFixtureValue(value: KernValue): CoreFixtureValue {
  switch (value.kind) {
    case 'null':
      return null;
    case 'undefined':
      return CORE_FIXTURE_UNDEFINED;
    case 'boolean':
    case 'number':
    case 'string':
      return value.value;
    // Slice 1b — a runner-native Decimal serializes to its BARE CANONICAL STRING,
    // exactly matching the ReferenceRunner's observable (`trace.events[0].value` is
    // the canonical string `evalDecimalExpression` renders). This is what makes
    // `observeCore(expr).value` === `observeReference(expr).value` for Decimal.
    // NOTE: this is the SERIALIZATION boundary (a value the probe reads OUT), not a
    // downstream operator USE — so it is correct for it to render rather than throw.
    case 'decimal':
      return value.canonical;
    case 'array':
      return value.items.map(kernValueToCoreFixtureValue);
    case 'record':
      if (isReservedFixtureSentinelRecord(value.entries)) {
        throw new CoreRuntimeContractAdapterError(
          'KERN record value uses reserved core fixture sentinel shape: __kernFixture.',
        );
      }
      return Object.fromEntries(
        Object.entries(value.entries).map(([key, entry]) => [key, kernValueToCoreFixtureValue(entry)]),
      );
    case 'function':
    case 'builtin':
    case 'class':
    case 'bound-method':
    case 'super':
      return CORE_FIXTURE_FUNCTION;
    case 'instance':
      if (isReservedFixtureSentinelRecord(value.fields)) {
        throw new CoreRuntimeContractAdapterError(
          'KERN instance value uses reserved core fixture sentinel shape: __kernFixture.',
        );
      }
      return Object.fromEntries(
        Object.entries(value.fields).map(([key, entry]) => [key, kernValueToCoreFixtureValue(entry)]),
      );
  }
}

export function coreFixtureValueToKernValue(value: CoreFixtureValue): KernValue {
  if (value === null) return brandValue({ kind: 'null' });
  if (isCoreFixtureUndefined(value)) return brandValue({ kind: 'undefined' });
  if (isCoreFixtureFunction(value)) {
    throw new CoreRuntimeContractAdapterError(
      'Core Function fixture references cannot be materialized as runtime code.',
    );
  }
  switch (typeof value) {
    case 'boolean':
      return brandValue({ kind: 'boolean', value });
    case 'number':
      return brandValue({ kind: 'number', value });
    case 'string':
      return brandValue({ kind: 'string', value });
    case 'object': {
      if (Array.isArray(value)) {
        return brandValue({ kind: 'array', items: value.map(coreFixtureValueToKernValue) });
      }
      const entries = Object.create(null) as Record<string, KernValue>;
      for (const [key, entry] of Object.entries(value)) entries[key] = coreFixtureValueToKernValue(entry);
      return brandValue({ kind: 'record', entries });
    }
  }
}

export function roundTripKernContractDataValue(value: KernValue): KernValue {
  // Slice 1b — a `decimal` is a TERMINAL runtime value: it serializes to its bare
  // canonical string ONLY for the parity-probe observable, which cannot be decoded
  // back to a `decimal` (a bare string decodes to `{kind:'string'}`). Round-tripping
  // it would SILENTLY change the value kind, so refuse loudly instead. Decimal is not
  // contract-fixture data; this guard fails fast if a future caller routes one here.
  if (value.kind === 'decimal') {
    throw new CoreRuntimeContractAdapterError(
      'KERN Decimal is a terminal runtime value and does not round-trip through contract fixture data.',
    );
  }
  return coreFixtureValueToKernValue(kernValueToCoreFixtureValue(value));
}

function isReservedFixtureSentinelRecord(entries: Record<string, KernValue>): boolean {
  return (
    Object.keys(entries).length === 1 &&
    entries.__kernFixture?.kind === 'string' &&
    (entries.__kernFixture.value === 'Undefined' || entries.__kernFixture.value === 'Function')
  );
}
