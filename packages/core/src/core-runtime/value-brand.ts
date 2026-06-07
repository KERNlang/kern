export const KERN_VALUE_BRAND: unique symbol = Symbol('KERN core runtime value');

export function brandValue<T extends object>(value: T): T {
  Object.defineProperty(value, KERN_VALUE_BRAND, { value: true });
  return value;
}
