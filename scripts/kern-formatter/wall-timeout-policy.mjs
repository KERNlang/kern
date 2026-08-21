export const DEFAULT_KERN_FORMATTER_WALL_TIMEOUT_MS = 900_000;

export function resolveKernFormatterWallTimeoutMs(env) {
  if (!Object.hasOwn(env, 'KERN_FORMATTER_WALL_TIMEOUT_MS')) {
    return DEFAULT_KERN_FORMATTER_WALL_TIMEOUT_MS;
  }

  const raw = env.KERN_FORMATTER_WALL_TIMEOUT_MS;
  if (typeof raw !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    throw new TypeError('KERN_FORMATTER_WALL_TIMEOUT_MS must be a canonical non-negative integer');
  }

  const timeoutMs = Number(raw);
  if (!Number.isSafeInteger(timeoutMs)) {
    throw new TypeError('KERN_FORMATTER_WALL_TIMEOUT_MS must be a safe integer');
  }
  if (timeoutMs === 0 && Object.hasOwn(env, 'CI')) {
    throw new TypeError('KERN_FORMATTER_WALL_TIMEOUT_MS cannot be disabled in CI');
  }
  return timeoutMs;
}
