import { STYLE_SHORTHANDS, VALUE_SHORTHANDS } from './spec.js';

export function expandStyleKey(key: string): string {
  return STYLE_SHORTHANDS[key] || key;
}

export function expandStyleValue(value: string): string | number {
  if (VALUE_SHORTHANDS[value]) return VALUE_SHORTHANDS[value];
  const num = Number(value);
  if (!Number.isNaN(num) && value !== '') return num;
  return value;
}

export function expandStyles(styles: Record<string, string>): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(styles)) {
    result[expandStyleKey(k)] = expandStyleValue(v);
  }
  return result;
}
