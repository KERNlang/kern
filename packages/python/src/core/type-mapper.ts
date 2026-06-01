import { mapTsTypeToPython } from '../type-map.js';

/**
 * Convert a KERN/TypeScript type string to a Python type string.
 */
export function mapKernTypeToPython(tsType: string): string {
  return mapTsTypeToPython(tsType);
}
