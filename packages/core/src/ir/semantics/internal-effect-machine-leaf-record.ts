import { isPortableRecordValue, isPortableScalar, isRunnerPortableArrayValue } from './portable-scalar-domain.js';

export function internalMachineRecordArrayFields(value: unknown): Set<string> {
  const fields = new Set<string>();
  if (!isPortableRecordValue(value)) return fields;
  for (const [name, item] of Object.entries(value)) {
    if (isRunnerPortableArrayValue(item) && item.every((entry) => isPortableScalar(entry))) fields.add(name);
  }
  return fields;
}
