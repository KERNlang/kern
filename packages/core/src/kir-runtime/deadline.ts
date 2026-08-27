import { KernKirFault } from './contracts.js';

export interface ExecutionDeadline {
  readonly remainingMs: () => number | null;
  readonly check: () => void;
}

function ownData(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function timeoutFrom(input: unknown): number | null {
  const timeout = ownData(ownData(input, 'control'), 'timeoutMs');
  return Number.isSafeInteger(timeout) && (timeout as number) >= 1 && (timeout as number) <= 2_147_483_647
    ? (timeout as number)
    : null;
}

export function createExecutionDeadline(input: unknown): ExecutionDeadline {
  const timeout = timeoutFrom(input);
  const expiresAt = timeout === null ? null : performance.now() + timeout;
  const remainingMs = (): number | null => (expiresAt === null ? null : Math.max(0, expiresAt - performance.now()));
  const check = (): void => {
    if (expiresAt !== null && performance.now() >= expiresAt) {
      throw new KernKirFault('execution-timeout', 'execution', 'execution deadline expired');
    }
  };
  return Object.freeze({ remainingMs, check });
}
