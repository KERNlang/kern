import { isOwnedSemanticAtomicValue } from './semantic-atomic-ownership.js';

type OwnComposite = <T extends object>(value: T) => T;

const rejectedSemanticClone = Object.freeze(Object.create(null)) as object;
const MAP_CONSTRUCTOR = Map;
const SET_CONSTRUCTOR = Set;
const REFLECT_APPLY = Reflect.apply;
const MAP_ENTRIES = Map.prototype.entries;
const MAP_GET = Map.prototype.get;
const MAP_SET = Map.prototype.set;
const SET_ADD = Set.prototype.add;
const SET_VALUES = Set.prototype.values;
const MAP_ITERATOR_NEXT = Object.getPrototypeOf(
  REFLECT_APPLY(MAP_ENTRIES, new MAP_CONSTRUCTOR(), []),
).next as () => IteratorResult<[unknown, unknown]>;
const SET_ITERATOR_NEXT = Object.getPrototypeOf(
  REFLECT_APPLY(SET_VALUES, new SET_CONSTRUCTOR(), []),
).next as () => IteratorResult<unknown>;

function mapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return REFLECT_APPLY(MAP_GET, map, [key]) as V | undefined;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  REFLECT_APPLY(MAP_SET, map, [key, value]);
}

function forEachMapEntry<K, V>(map: ReadonlyMap<K, V>, visit: (key: K, value: V) => void): void {
  const iterator = REFLECT_APPLY(MAP_ENTRIES, map, []) as MapIterator<[K, V]>;
  while (true) {
    const step = REFLECT_APPLY(MAP_ITERATOR_NEXT, iterator, []) as IteratorResult<[K, V]>;
    if (step.done) return;
    visit(step.value[0], step.value[1]);
  }
}

function forEachSetValue<T>(set: ReadonlySet<T>, visit: (value: T) => void): void {
  const iterator = REFLECT_APPLY(SET_VALUES, set, []) as SetIterator<T>;
  while (true) {
    const step = REFLECT_APPLY(SET_ITERATOR_NEXT, iterator, []) as IteratorResult<T>;
    if (step.done) return;
    visit(step.value);
  }
}

export function copyExactSemanticMap<K, V>(source?: ReadonlyMap<K, V>): Map<K, V> {
  const out = new MAP_CONSTRUCTOR<K, V>();
  if (source) forEachMapEntry(source, (key, value) => mapSet(out, key, value));
  return out;
}

export function copyExactSemanticMapValues<K, V, R>(
  source: ReadonlyMap<K, V>,
  copyValue: (value: V) => R,
): Map<K, R> {
  const out = new MAP_CONSTRUCTOR<K, R>();
  forEachMapEntry(source, (key, value) => mapSet(out, key, copyValue(value)));
  return out;
}

export function copyExactSemanticSet<T>(source?: ReadonlySet<T>): Set<T> {
  const out = new SET_CONSTRUCTOR<T>();
  if (source) forEachSetValue(source, (value) => REFLECT_APPLY(SET_ADD, out, [value]));
  return out;
}

export function cloneSemanticRecordArrayFields(
  fields: ReadonlyMap<string, Set<string> | null>,
  own: OwnComposite,
): Map<string, Set<string> | null> {
  return own(
    copyExactSemanticMapValues(fields, (value) =>
      value === null ? null : own(copyExactSemanticSet(value)),
    ),
  );
}

function hasDefaultDataDescriptor(descriptor: PropertyDescriptor | undefined): boolean {
  return Boolean(
    descriptor &&
      'value' in descriptor &&
      descriptor.get === undefined &&
      descriptor.set === undefined &&
      descriptor.configurable === true &&
      descriptor.enumerable === true &&
      descriptor.writable === true,
  );
}

/** Validate the closed isolated-execution clone grammar without invoking guest code. */
export function assertExactSemanticCloneValue(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new TypeError('portable: isolated binding contains a non-finite number');
  }
  if (typeof value !== 'object') throw new TypeError('portable: isolated binding contains an unsupported value');
  if (value === rejectedSemanticClone) throw new TypeError('portable: isolated binding was rejected during cloning');
  if (isOwnedSemanticAtomicValue(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError('portable: isolated binding is not safely inspectable');
  }
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new TypeError('portable: isolated array prototype is invalid');
    const length = descriptors.length;
    if (
      !dataDescriptor(length) ||
      !Number.isSafeInteger(length.value) ||
      length.value < 0 ||
      length.writable !== true ||
      length.enumerable !== false ||
      length.configurable !== false
    ) {
      throw new TypeError('portable: isolated array length is invalid');
    }
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== length.value + 1) throw new TypeError('portable: isolated arrays must be dense');
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!hasDefaultDataDescriptor(descriptor)) throw new TypeError('portable: isolated array descriptor is invalid');
      assertExactSemanticCloneValue(descriptor.value, seen);
    }
    return;
  }
  if (prototype === Map.prototype) {
    if (Reflect.ownKeys(value).length !== 0) throw new TypeError('portable: isolated Map is decorated');
    forEachMapEntry(value as Map<unknown, unknown>, (key, nested) => {
      assertExactSemanticCloneValue(key, seen);
      assertExactSemanticCloneValue(nested, seen);
    });
    return;
  }
  if (prototype === Set.prototype) {
    if (Reflect.ownKeys(value).length !== 0) throw new TypeError('portable: isolated Set is decorated');
    forEachSetValue(value as Set<unknown>, (nested) => assertExactSemanticCloneValue(nested, seen));
    return;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('portable: isolated binding prototype is invalid');
  }

  const marker = descriptors.__kernRunnerClassInstance;
  if (dataDescriptor(marker) && marker.value === true) {
    const allowed: readonly PropertyKey[] = ['__kernRunnerClassInstance', 'className', 'fields', 'module'];
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => !allowed.includes(key)) || keys.length < 3 || keys.length > 4) {
      throw new TypeError('portable: isolated runner instance shape is invalid');
    }
    if (!hasDefaultDataDescriptor(marker)) throw new TypeError('portable: isolated runner marker is invalid');
    const className = descriptors.className;
    const fields = descriptors.fields;
    if (
      !hasDefaultDataDescriptor(className) ||
      typeof className.value !== 'string' ||
      !hasDefaultDataDescriptor(fields)
    ) {
      throw new TypeError('portable: isolated runner instance descriptor is invalid');
    }
    if (descriptors.module && !hasDefaultDataDescriptor(descriptors.module)) {
      throw new TypeError('portable: isolated runner module descriptor is invalid');
    }
    assertExactSemanticCloneValue(fields.value, seen);
    return;
  }

  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !hasDefaultDataDescriptor(descriptors[key])) {
      throw new TypeError('portable: isolated record descriptor is invalid');
    }
    assertExactSemanticCloneValue(descriptors[key]?.value, seen);
  }
}

function rejectedClone(source: object, memo: Map<object, unknown>): object {
  mapSet(memo, source, rejectedSemanticClone);
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
  mapSet(memo, source, clone);
  const hasDefaultIndexDescriptors = indexKeys.every(
    (key) => descriptors[key].configurable === true && descriptors[key].writable === true,
  );
  if (hasDefaultIndexDescriptors && Object.getPrototypeOf(clone) === Array.prototype) {
    Object.setPrototypeOf(clone, null);
    for (const key of indexKeys) clone[Number(key)] = cloneSemanticBindingValue(descriptors[key].value, memo, own);
    Object.setPrototypeOf(clone, Array.prototype);
  } else {
    for (const key of indexKeys) {
      Object.defineProperty(clone, key, {
        ...descriptors[key],
        value: cloneSemanticBindingValue(descriptors[key].value, memo, own),
      });
    }
  }
  return clone;
}

function cloneExactMap(source: Map<unknown, unknown>, memo: Map<object, unknown>, own: OwnComposite): unknown {
  if (Reflect.ownKeys(source).length !== 0) return rejectedClone(source, memo);
  const clone = own(new MAP_CONSTRUCTOR<unknown, unknown>());
  mapSet(memo, source, clone);
  forEachMapEntry(source, (key, value) => {
    mapSet(clone, cloneSemanticBindingValue(key, memo, own), cloneSemanticBindingValue(value, memo, own));
  });
  return clone;
}

function cloneExactSet(source: Set<unknown>, memo: Map<object, unknown>, own: OwnComposite): unknown {
  if (Reflect.ownKeys(source).length !== 0) return rejectedClone(source, memo);
  const clone = own(new SET_CONSTRUCTOR<unknown>());
  mapSet(memo, source, clone);
  forEachSetValue(source, (value) => {
    REFLECT_APPLY(SET_ADD, clone, [cloneSemanticBindingValue(value, memo, own)]);
  });
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
  mapSet(memo, source, clone);
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
  mapSet(memo, source, clone);
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
  if (value === rejectedSemanticClone) return value;
  if (isOwnedSemanticAtomicValue(value) || value === null || typeof value !== 'object') return value;
  const cached = mapGet(memo, value);
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

export function cloneSemanticBindings(
  bindings: ReadonlyMap<string, unknown>,
  memo: Map<object, unknown>,
  own: OwnComposite,
): Map<string, unknown> {
  const out = own(new MAP_CONSTRUCTOR<string, unknown>());
  forEachMapEntry(bindings, (key, value) => {
    if (typeof key !== 'string') throw new TypeError('portable: isolated binding key is invalid');
    mapSet(out, key, cloneSemanticBindingValue(value, memo, own));
  });
  return out;
}

export function assertExactSemanticBindings(
  bindings: ReadonlyMap<string, unknown>,
  seen: WeakSet<object>,
): void {
  forEachMapEntry(bindings, (key, value) => {
    if (typeof key !== 'string') throw new TypeError('portable: isolated binding key is invalid');
    assertExactSemanticCloneValue(value, seen);
  });
}
