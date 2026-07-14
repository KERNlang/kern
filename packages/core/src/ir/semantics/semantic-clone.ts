import { isOwnedSemanticAtomicValue } from './semantic-atomic-ownership.js';

type OwnComposite = <T extends object>(value: T) => T;

const rejectedSemanticClone = Object.freeze(Object.create(null)) as object;

function rejectedClone(source: object, memo: Map<object, unknown>): object {
  memo.set(source, rejectedSemanticClone);
  return rejectedSemanticClone;
}

function dataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return (
    descriptor !== undefined && 'value' in descriptor && descriptor.get === undefined && descriptor.set === undefined
  );
}

function cloneExactArray(source: unknown[], memo: Map<object, unknown>, own: OwnComposite): unknown {
  const descriptors = Object.getOwnPropertyDescriptors(source) as Record<string, PropertyDescriptor>;
  const keys = Reflect.ownKeys(descriptors);
  const length = descriptors.length;
  if (
    !dataDescriptor(length) ||
    typeof length.value !== 'number' ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0 ||
    length.enumerable !== false ||
    length.configurable !== false ||
    keys.some((key) => typeof key !== 'string')
  ) {
    return rejectedClone(source, memo);
  }
  const indexKeys = (keys as string[]).filter((key) => key !== 'length');
  for (const key of indexKeys) {
    const index = Number(key);
    const descriptor = descriptors[key];
    if (
      !/^(?:0|[1-9][0-9]*)$/.test(key) ||
      !Number.isSafeInteger(index) ||
      index >= length.value ||
      !dataDescriptor(descriptor) ||
      descriptor.enumerable !== true
    ) {
      return rejectedClone(source, memo);
    }
  }

  const clone = new Array(length.value);
  if (indexKeys.length === length.value) own(clone);
  else Object.setPrototypeOf(clone, null);
  memo.set(source, clone);
  for (const key of indexKeys) {
    clone[Number(key)] = cloneSemanticBindingValue(descriptors[key].value, memo, own);
  }
  return clone;
}

function cloneExactMap(source: Map<unknown, unknown>, memo: Map<object, unknown>, own: OwnComposite): unknown {
  if (Reflect.ownKeys(source).length !== 0) return rejectedClone(source, memo);
  const clone = own(new Map<unknown, unknown>());
  memo.set(source, clone);
  for (const [key, value] of Map.prototype.entries.call(source) as MapIterator<[unknown, unknown]>) {
    clone.set(cloneSemanticBindingValue(key, memo, own), cloneSemanticBindingValue(value, memo, own));
  }
  return clone;
}

function cloneExactSet(source: Set<unknown>, memo: Map<object, unknown>, own: OwnComposite): unknown {
  if (Reflect.ownKeys(source).length !== 0) return rejectedClone(source, memo);
  const clone = own(new Set<unknown>());
  memo.set(source, clone);
  for (const value of Set.prototype.values.call(source) as SetIterator<unknown>) {
    clone.add(cloneSemanticBindingValue(value, memo, own));
  }
  return clone;
}

function cloneRunnerInstance(
  source: object,
  descriptors: PropertyDescriptorMap,
  memo: Map<object, unknown>,
  own: OwnComposite,
): unknown | undefined {
  const marker = descriptors.__kernRunnerClassInstance;
  if (!dataDescriptor(marker) || marker.value !== true) return undefined;
  const className = descriptors.className;
  const fields = descriptors.fields;
  const module = descriptors.module;
  if (
    !dataDescriptor(className) ||
    typeof className.value !== 'string' ||
    !dataDescriptor(fields) ||
    typeof fields.value !== 'object' ||
    fields.value === null ||
    (module !== undefined && !dataDescriptor(module))
  ) {
    return rejectedClone(source, memo);
  }
  const clone: Record<string, unknown> = {
    __kernRunnerClassInstance: true,
    className: className.value,
    fields: rejectedSemanticClone,
  };
  if (module !== undefined) clone.module = module.value;
  own(clone);
  memo.set(source, clone);
  clone.fields = cloneSemanticBindingValue(fields.value, memo, own);
  return clone;
}

function cloneExactRecord(
  source: object,
  prototype: object | null,
  memo: Map<object, unknown>,
  own: OwnComposite,
): unknown {
  const descriptors = Object.getOwnPropertyDescriptors(source);
  const runner = cloneRunnerInstance(source, descriptors, memo, own);
  if (runner !== undefined) return runner;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== 'string' || !dataDescriptor(descriptors[key]) || !descriptors[key].enumerable)
  ) {
    return rejectedClone(source, memo);
  }
  const clone = own(Object.create(prototype) as Record<string, unknown>);
  memo.set(source, clone);
  for (const key of keys as string[]) {
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: cloneSemanticBindingValue(descriptors[key].value, memo, own),
      writable: true,
    });
  }
  return clone;
}

/** Clone host bindings without invoking accessors or user-overridable collection iterators. */
export function cloneSemanticBindingValue(value: unknown, memo: Map<object, unknown>, own: OwnComposite): unknown {
  if (isOwnedSemanticAtomicValue(value) || value === null || typeof value !== 'object') return value;
  const cached = memo.get(value);
  if (cached !== undefined) return cached;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (Array.isArray(value)) {
      return prototype === Array.prototype ? cloneExactArray(value, memo, own) : rejectedClone(value, memo);
    }
    if (prototype === Map.prototype) return cloneExactMap(value as Map<unknown, unknown>, memo, own);
    if (prototype === Set.prototype) return cloneExactSet(value as Set<unknown>, memo, own);
    if (prototype === Object.prototype || prototype === null) {
      return cloneExactRecord(value, prototype, memo, own);
    }
  } catch {
    // Hostile proxies and exotic objects fail closed as an unowned inert value.
  }
  return rejectedClone(value, memo);
}
