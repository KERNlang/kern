const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTORS = Object.getOwnPropertyDescriptors;
const REFLECT_OWN_KEYS = Reflect.ownKeys;

function isBoundedPropertyKey(value: unknown): value is string | number | boolean | null | undefined {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

export function readLambdaOwnedProperty(receiver: unknown, key: unknown): unknown {
  if (receiver === null || receiver === undefined) throw new Error('lambda: property receiver is nullish');
  if (!isBoundedPropertyKey(key)) throw new Error('lambda: property key must be a bounded scalar');
  const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(receiver as object, key as PropertyKey);
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set || !('value' in descriptor)) {
    throw new Error('lambda: accessor properties are not executable');
  }
  if (typeof descriptor.value === 'function') throw new Error('lambda: host function properties are not executable');
  return descriptor.value;
}

export function copyLambdaOwnedEnumerableProperties(target: Record<string, unknown>, source: unknown): void {
  if (source === null || source === undefined) return;
  if (typeof source === 'string') {
    for (let index = 0; index < source.length; index += 1) target[String(index)] = source[index];
    return;
  }
  if (typeof source !== 'object') {
    if (typeof source === 'function') throw new Error('lambda: host functions are not executable');
    return;
  }
  const descriptors = OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(source);
  for (const key of REFLECT_OWN_KEYS(descriptors)) {
    const descriptorEntry = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(descriptors, key);
    if (!descriptorEntry || !('value' in descriptorEntry)) {
      throw new Error('lambda: invalid property descriptor map');
    }
    const descriptor = descriptorEntry.value as PropertyDescriptor;
    if (!descriptor.enumerable) continue;
    if (typeof key !== 'string') throw new Error('lambda: symbol properties are not executable');
    if (descriptor.get || descriptor.set || !('value' in descriptor)) {
      throw new Error('lambda: accessor properties are not executable');
    }
    if (typeof descriptor.value === 'function') {
      throw new Error('lambda: host function properties are not executable');
    }
    target[key] = descriptor.value;
  }
}
