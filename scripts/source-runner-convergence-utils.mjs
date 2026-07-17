export const REQUIRED_DEFERRED = Object.freeze({
  'runner-classes-state': ['environment', 'legacy'],
});

export function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
}
