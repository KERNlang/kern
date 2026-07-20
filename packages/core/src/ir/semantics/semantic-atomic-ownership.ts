const ownedSemanticAtomicValues = new WeakSet<object>();

/** Internal provenance marker for immutable semantic atoms created by the machine. */
export function ownSemanticAtomicValue<T extends object>(value: T): T {
  ownedSemanticAtomicValues.add(value);
  return value;
}

export function isOwnedSemanticAtomicValue(value: unknown): value is object {
  return typeof value === 'object' && value !== null && ownedSemanticAtomicValues.has(value);
}
