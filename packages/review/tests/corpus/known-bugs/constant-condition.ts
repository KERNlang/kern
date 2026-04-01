// BUG: constant condition in if statement — branch always taken
export function process(items: string[]): string[] {
  if (true) {
    return items.map((s) => s.toUpperCase());
  }
  return items; // unreachable
}
