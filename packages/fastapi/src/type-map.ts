/**
 * TypeScript type strings → Python type strings
 */

const SIMPLE_MAP: Record<string, string> = {
  string: 'str',
  number: 'float',
  boolean: 'bool',
  any: 'Any',
  unknown: 'Any',
  void: 'None',
  undefined: 'None',
  null: 'None',
  Date: 'datetime',
  object: 'dict[str, Any]',
};

/**
 * Convert a TypeScript type string to a Python type string.
 *
 * Handles: primitives, arrays (T[]), Record<K,V>, Promise<T>, union types,
 * string literal unions ("a"|"b"), T | null → T | None, generics.
 */
export function mapTsTypeToPython(tsType: string): string {
  const trimmed = tsType.trim();

  // Simple mappings
  if (SIMPLE_MAP[trimmed]) return SIMPLE_MAP[trimmed];

  // String literal union: "a" | "b" | "c" → Literal["a", "b", "c"]
  if (/^["']/.test(trimmed) || (trimmed.includes('|') && trimmed.split('|').every(p => /^\s*["']/.test(p)))) {
    const parts = trimmed.split('|').map(p => p.trim());
    const literals = parts.map(p => {
      const unquoted = p.replace(/^['"]|['"]$/g, '');
      return `"${unquoted}"`;
    });
    return `Literal[${literals.join(', ')}]`;
  }

  // Array: T[] → list[T]
  if (trimmed.endsWith('[]')) {
    const inner = trimmed.slice(0, -2);
    return `list[${mapTsTypeToPython(inner)}]`;
  }

  // Array<T> → list[T]
  const arrayMatch = trimmed.match(/^Array<(.+)>$/);
  if (arrayMatch) {
    return `list[${mapTsTypeToPython(arrayMatch[1])}]`;
  }

  // Record<K, V> → dict[K, V]
  const recordMatch = trimmed.match(/^Record<(.+),\s*(.+)>$/);
  if (recordMatch) {
    return `dict[${mapTsTypeToPython(recordMatch[1])}, ${mapTsTypeToPython(recordMatch[2])}]`;
  }

  // Promise<T> → T (async def handles it)
  const promiseMatch = trimmed.match(/^Promise<(.+)>$/);
  if (promiseMatch) {
    return mapTsTypeToPython(promiseMatch[1]);
  }

  // Map<K, V> → dict[K, V]
  const mapMatch = trimmed.match(/^Map<(.+),\s*(.+)>$/);
  if (mapMatch) {
    return `dict[${mapTsTypeToPython(mapMatch[1])}, ${mapTsTypeToPython(mapMatch[2])}]`;
  }

  // Set<T> → set[T]
  const setMatch = trimmed.match(/^Set<(.+)>$/);
  if (setMatch) {
    return `set[${mapTsTypeToPython(setMatch[1])}]`;
  }

  // Union types: T | U
  if (trimmed.includes('|')) {
    const parts = trimmed.split('|').map(p => p.trim()).filter(Boolean);
    const mapped = parts.map(p => mapTsTypeToPython(p));
    return mapped.join(' | ');
  }

  // Passthrough (custom types, capitalized identifiers)
  return trimmed;
}

/** Convert a camelCase or PascalCase identifier to snake_case. */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/** Convert a name to SCREAMING_SNAKE_CASE. */
export function toScreamingSnake(name: string): string {
  return toSnakeCase(name).toUpperCase();
}
