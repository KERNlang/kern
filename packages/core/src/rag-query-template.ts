export type RagQueryTemplateType = 'string' | 'number' | 'boolean' | 'enum';
export type RagQueryTemplateParamValue = string | number | boolean;

export interface RagQueryTemplateSlot {
  readonly name: string;
  readonly type: RagQueryTemplateType;
  readonly enumValues?: readonly string[];
  readonly start: number;
  readonly end: number;
}

export interface ParsedRagQueryTemplate {
  readonly template: string;
  readonly slots: readonly RagQueryTemplateSlot[];
}

const SLOT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const DECIMAL_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u;

export function parseRagQueryTemplate(
  template: string,
  label = 'KERN RAG queryTemplate',
): ParsedRagQueryTemplate {
  if (typeof template !== 'string' || template.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  const slots: RagQueryTemplateSlot[] = [];
  const byName = new Map<string, RagQueryTemplateSlot>();
  let index = 0;
  while (index < template.length) {
    const open = template.indexOf('{{', index);
    const closeOnly = template.indexOf('}}', index);
    if (closeOnly !== -1 && (open === -1 || closeOnly < open)) {
      throw new Error(`${label} contains an unmatched '}}'.`);
    }
    if (open === -1) break;
    const close = template.indexOf('}}', open + 2);
    if (close === -1) throw new Error(`${label} contains an unmatched '{{'.`);
    const raw = template.slice(open + 2, close).trim();
    const slot = parseRagQueryTemplateSlot(raw, open, close + 2, label);
    const previous = byName.get(slot.name);
    if (previous && !sameSlotContract(previous, slot)) {
      throw new Error(`${label} param '${slot.name}' is declared with conflicting types.`);
    }
    if (!previous) byName.set(slot.name, slot);
    slots.push(slot);
    index = close + 2;
  }
  if (slots.length === 0) throw new Error(`${label} must contain at least one '{{name:type}}' slot.`);
  return { template, slots };
}

export function renderRagQueryTemplate(
  template: string,
  params: Readonly<Record<string, unknown>> | undefined,
  label = 'KERN RAG queryTemplate',
): string {
  const parsed = parseRagQueryTemplate(template, label);
  let out = '';
  let cursor = 0;
  for (const slot of parsed.slots) {
    out += template.slice(cursor, slot.start);
    out += formatRagQueryTemplateValue(slot, ownTemplateParam(params, slot.name), label);
    cursor = slot.end;
  }
  out += template.slice(cursor);
  if (out.trim().length === 0) throw new Error(`${label} rendered an empty query.`);
  return out;
}

function ownTemplateParam(params: Readonly<Record<string, unknown>> | undefined, name: string): unknown {
  return params && Object.hasOwn(params, name) ? params[name] : undefined;
}

function parseRagQueryTemplateSlot(
  raw: string,
  start: number,
  end: number,
  label: string,
): RagQueryTemplateSlot {
  const colon = raw.indexOf(':');
  if (colon <= 0) {
    throw new Error(`${label} slot '{{${raw}}}' must use '{{name:type}}'.`);
  }
  const name = raw.slice(0, colon).trim();
  const typeText = raw.slice(colon + 1).trim();
  if (typeText.length === 0) {
    throw new Error(`${label} slot '${name}' must declare a type.`);
  }
  if (!SLOT_NAME_RE.test(name)) {
    throw new Error(`${label} slot name '${name}' must be an identifier.`);
  }
  if (typeText === 'string' || typeText === 'number' || typeText === 'boolean') {
    return { name, type: typeText, start, end };
  }
  const enumMatch = /^enum\((.*)\)$/u.exec(typeText);
  if (enumMatch) {
    if (enumMatch[1].trim().length === 0) throw new Error(`${label} enum slot '${name}' must declare at least one value.`);
    const enumValues = enumMatch[1].split(',').map((value) => value.trim());
    if (enumValues.some((value) => value.length === 0)) {
      throw new Error(`${label} enum slot '${name}' must not contain empty values.`);
    }
    if (new Set(enumValues).size !== enumValues.length) {
      throw new Error(`${label} enum slot '${name}' must not repeat values.`);
    }
    return { name, type: 'enum', enumValues, start, end };
  }
  throw new Error(`${label} slot '${name}' has unsupported type '${typeText}'.`);
}

function sameSlotContract(left: RagQueryTemplateSlot, right: RagQueryTemplateSlot): boolean {
  if (left.type !== right.type) return false;
  if (left.type !== 'enum') return true;
  return (left.enumValues ?? []).join('\0') === (right.enumValues ?? []).join('\0');
}

function formatRagQueryTemplateValue(slot: RagQueryTemplateSlot, value: unknown, label: string): string {
  if (value === undefined || value === null) {
    throw new Error(`${label} missing required param '${slot.name}'.`);
  }
  if (slot.type === 'string') {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${label} param '${slot.name}' must be a non-empty string.`);
    }
    return value;
  }
  if (slot.type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && DECIMAL_NUMBER_RE.test(value.trim()) && Number.isFinite(Number(value))) {
      return value.trim();
    }
    throw new Error(`${label} param '${slot.name}' must be a finite number.`);
  }
  if (slot.type === 'boolean') {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string' && /^(true|false)$/u.test(value.trim())) return value.trim();
    throw new Error(`${label} param '${slot.name}' must be true or false.`);
  }
  const enumValue = typeof value === 'string' ? value.trim() : value;
  if (typeof enumValue !== 'string' || !(slot.enumValues ?? []).includes(enumValue)) {
    throw new Error(`${label} param '${slot.name}' must be one of: ${(slot.enumValues ?? []).join(', ')}.`);
  }
  return enumValue;
}
