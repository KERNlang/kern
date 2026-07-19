/** Target-neutral identifier case conversion shared by core and Python codegen. */

/** Convert a camelCase or PascalCase identifier to snake_case. */
export function toSnakeCaseIdentifier(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}
