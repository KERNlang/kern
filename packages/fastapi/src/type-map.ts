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
  const unwrapped = unwrapRedundantParens(trimmed);
  if (unwrapped !== trimmed) return mapTsTypeToPython(unwrapped);

  // Simple mappings
  if (SIMPLE_MAP[trimmed]) return SIMPLE_MAP[trimmed];

  const functionType = parseFunctionType(trimmed);
  if (functionType) return functionType;

  if (isWholeObjectType(trimmed)) return 'dict[str, Any]';

  // String literal union: "a" | "b" | "c" → Literal["a", "b", "c"]
  if (/^["']/.test(trimmed) || (trimmed.includes('|') && trimmed.split('|').every((p) => /^\s*["']/.test(p)))) {
    const parts = trimmed.split('|').map((p) => p.trim());
    const literals = parts.map((p) => {
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

  // Slice 4 — Result<T, E> → Result[T, E] / Option<T> → Option[T]. The
  // type aliases are emitted by `pythonStdlibPreamble` when the module
  // references them; here we only translate the syntax. Splitting `T, E`
  // requires depth-aware parsing because nested generics may also use `,`.
  const resultMatch = trimmed.match(/^Result<([\s\S]+)>$/);
  if (resultMatch) {
    const args = splitGenericArgs(resultMatch[1]);
    if (args.length === 2) {
      return `Result[${mapTsTypeToPython(args[0])}, ${mapTsTypeToPython(args[1])}]`;
    }
  }
  const optionMatch = trimmed.match(/^Option<([\s\S]+)>$/);
  if (optionMatch) {
    return `Option[${mapTsTypeToPython(optionMatch[1])}]`;
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
    const parts = trimmed
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean);
    const mapped = parts.map((p) => mapTsTypeToPython(p));
    return mapped.join(' | ');
  }

  // Passthrough (custom types, capitalized identifiers)
  return trimmed;
}

function parseFunctionType(tsType: string): string | null {
  if (!tsType.startsWith('(')) return null;
  const closeIdx = findMatchingParen(tsType, 0);
  if (closeIdx === -1) return null;
  const tail = tsType.slice(closeIdx + 1).trim();
  if (!tail.startsWith('=>')) return null;

  const paramsRaw = tsType.slice(1, closeIdx).trim();
  const returnRaw = tail.slice(2).trim();
  const returnType = returnRaw ? mapTsTypeToPython(returnRaw) : 'Any';
  if (!paramsRaw) return `Callable[[], ${returnType}]`;

  const paramTypes = splitTopLevel(paramsRaw, ',').map((param) => {
    const trimmedParam = param.trim();
    if (!trimmedParam) return 'Any';
    if (trimmedParam.startsWith('...')) return '...';
    const colonIdx = findTopLevelColon(trimmedParam);
    if (colonIdx === -1) return isIdentifierLike(trimmedParam) ? 'Any' : mapTsTypeToPython(trimmedParam);
    const typeRaw = trimmedParam.slice(colonIdx + 1).trim();
    return typeRaw ? mapTsTypeToPython(typeRaw) : 'Any';
  });
  if (paramTypes.includes('...')) return `Callable[..., ${returnType}]`;
  return `Callable[[${paramTypes.join(', ')}], ${returnType}]`;
}

function unwrapRedundantParens(input: string): string {
  if (!input.startsWith('(') || !input.endsWith(')')) return input;
  const closeIdx = findMatchingParen(input, 0);
  if (closeIdx !== input.length - 1) return input;
  return input.slice(1, -1).trim();
}

function findMatchingParen(input: string, openIdx: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | '' = '';
  let escaped = false;
  for (let i = openIdx; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findTopLevelColon(input: string): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | '' = '';
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '<' || ch === '[' || ch === '(' || ch === '{') depth++;
    else if ((ch === '>' || ch === ']' || ch === ')' || ch === '}') && depth > 0) depth--;
    else if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

function isWholeObjectType(input: string): boolean {
  if (!input.startsWith('{') || !input.endsWith('}')) return false;
  const closeIdx = findMatchingBrace(input, 0);
  return closeIdx === input.length - 1;
}

function findMatchingBrace(input: string, openIdx: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | '' = '';
  let escaped = false;
  for (let i = openIdx; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isIdentifierLike(input: string): boolean {
  return /^[A-Za-z_$][\w$]*\??$/.test(input);
}

/** Split a generic-args string at top-level `,`s — depth-aware so nested
 *  generics (`Result<Foo<X, Y>, Bar>`) don't get split mid-arg. */
function splitGenericArgs(s: string): string[] {
  return splitTopLevel(s, ',');
}

function splitTopLevel(s: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  let quote: '"' | "'" | '`' | '' = '';
  let escaped = false;
  for (const c of s) {
    if (quote) {
      current += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      current += c;
      continue;
    }
    if (c === '<' || c === '[' || c === '(' || c === '{') depth++;
    else if ((c === '>' || c === ']' || c === ')' || c === '}') && depth > 0) depth--;
    if (c === separator && depth === 0) {
      out.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
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
