import { assertPortableDecimalLiteral, isPortableDecimalLiteral } from '../../decimal/probe-gates.js';

const ownedDecimalValues = new WeakSet<object>();

export const DECIMAL_VALUE_TAG: unique symbol = Symbol('kern.decimalValue');

export interface DecimalValue {
  readonly [DECIMAL_VALUE_TAG]: true;
  readonly canonical: string;
}

export function makeDecimalValue(canonical: string): DecimalValue {
  assertPortableDecimalLiteral(canonical);
  const value = Object.freeze({ [DECIMAL_VALUE_TAG]: true as const, canonical });
  ownedDecimalValues.add(value);
  return value;
}

export function isOwnedDecimalValue(value: unknown): value is DecimalValue {
  if (typeof value !== 'object' || value === null || !ownedDecimalValues.has(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes('canonical') || !keys.includes(DECIMAL_VALUE_TAG)) return false;
  const canonical = Object.getOwnPropertyDescriptor(value, 'canonical');
  const tag = Object.getOwnPropertyDescriptor(value, DECIMAL_VALUE_TAG);
  return Boolean(
    canonical &&
      !canonical.get &&
      !canonical.set &&
      'value' in canonical &&
      typeof canonical.value === 'string' &&
      isPortableDecimalLiteral(canonical.value) &&
      canonical.writable === false &&
      canonical.enumerable === true &&
      canonical.configurable === false &&
      tag &&
      !tag.get &&
      !tag.set &&
      'value' in tag &&
      tag.value === true &&
      tag.writable === false &&
      tag.enumerable === true &&
      tag.configurable === false,
  );
}

export function isDecimalValue(value: unknown): value is DecimalValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [DECIMAL_VALUE_TAG]?: unknown })[DECIMAL_VALUE_TAG] === true &&
    typeof (value as { canonical?: unknown }).canonical === 'string'
  );
}

/** Recognize the canonical Decimal carrier without reading an accessor. */
export function isInspectableDecimalValue(value: unknown): value is DecimalValue {
  return isOwnedDecimalValue(value);
}
