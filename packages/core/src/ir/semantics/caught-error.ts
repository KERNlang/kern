import type { CanonicalError } from './trace.js';

/** Brand symbol marking a runtime caught-error value. */
export const CAUGHT_ERROR_TAG: unique symbol = Symbol('kern.caughtError');

/**
 * Frozen runtime representation exposed to the portable `.message` reader.
 * It is deliberately not a portable scalar or a host `Error` object.
 */
export interface CaughtErrorValue {
  readonly [CAUGHT_ERROR_TAG]: true;
  readonly kind: string;
  readonly message: string;
}

export function isCaughtErrorValue(value: unknown): value is CaughtErrorValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [CAUGHT_ERROR_TAG]?: unknown })[CAUGHT_ERROR_TAG] === true &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

export function makeCaughtErrorValue(error: CanonicalError): CaughtErrorValue | null {
  if (typeof error.message !== 'string') return null;
  return Object.freeze({ [CAUGHT_ERROR_TAG]: true as const, kind: error.kind, message: error.message });
}
