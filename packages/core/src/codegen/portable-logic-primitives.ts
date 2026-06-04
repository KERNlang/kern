/**
 * Portable logic primitive registry.
 *
 * This table names host-language patterns that KERN treats as portable intent
 * rather than target-specific syntax. Target packages still own the concrete
 * lowering, but the supported surface is declared once here so conformance
 * gaps do not become anonymous string-rewrite patches.
 */

export type PortableLogicPrimitiveId =
  | 'collection.has'
  | 'time.epochMs'
  | 'logic.not'
  | 'object.keys'
  | 'object.values'
  | 'object.entries'
  | 'string.trim'
  | 'string.split'
  | 'string.replaceFirst'
  | 'string.replaceAll';
export type PortableLogicTarget = 'ts' | 'python' | 'go';
export type PortableLogicSupport = 'stable' | 'preview' | 'unsupported';
export type PortableLogicPurity = 'pure' | 'reads-time';

export interface PortableLogicPrimitive {
  id: PortableLogicPrimitiveId;
  description: string;
  purity: PortableLogicPurity;
  hostPatterns: readonly string[];
  targets: Record<PortableLogicTarget, PortableLogicSupport>;
}

export const PORTABLE_LOGIC_PRIMITIVES = {
  'collection.has': {
    id: 'collection.has',
    description: 'Membership test over a constructed collection, e.g. JS new Set(xs).has(x).',
    purity: 'pure',
    hostPatterns: ['new Set(xs).has(x)'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'time.epochMs': {
    id: 'time.epochMs',
    description: 'Epoch-milliseconds extraction from a date/time value, e.g. JS new Date(x).getTime().',
    // Pure because the source value is already supplied; this is not Date.now().
    purity: 'pure',
    hostPatterns: ['new Date(x).getTime()'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'logic.not': {
    id: 'logic.not',
    description: 'Boolean negation over the portable truthiness domain, e.g. JS !x.',
    purity: 'pure',
    hostPatterns: ['!x', '!!x'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'object.keys': {
    id: 'object.keys',
    description: 'Own enumerable key extraction for portable record objects, e.g. JS Object.keys(obj).',
    purity: 'pure',
    hostPatterns: ['Object.keys(obj)'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'object.values': {
    id: 'object.values',
    description: 'Own enumerable value extraction for portable record objects, e.g. JS Object.values(obj).',
    purity: 'pure',
    hostPatterns: ['Object.values(obj)'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'object.entries': {
    id: 'object.entries',
    description: 'Own enumerable entry extraction for portable record objects, e.g. JS Object.entries(obj).',
    purity: 'pure',
    hostPatterns: ['Object.entries(obj)'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'string.trim': {
    id: 'string.trim',
    description: 'String boundary-whitespace trimming, e.g. JS value.trim().',
    purity: 'pure',
    hostPatterns: ['value.trim()'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'string.split': {
    id: 'string.split',
    description:
      'String splitting by a non-regex separator; Python lowering must emulate JS limit as result-length truncation.',
    purity: 'pure',
    hostPatterns: ['value.split(separator)', 'value.split(separator, limit)'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'string.replaceFirst': {
    id: 'string.replaceFirst',
    description:
      'First occurrence string replacement with non-regex search and literal replacement text, e.g. JS value.replace(a, b).',
    purity: 'pure',
    hostPatterns: ['value.replace(search, replacement)'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'string.replaceAll': {
    id: 'string.replaceAll',
    description:
      'All occurrences string replacement with non-regex search and literal replacement text, e.g. JS value.replaceAll(a, b).',
    purity: 'pure',
    hostPatterns: ['value.replaceAll(search, replacement)'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
} as const satisfies Record<PortableLogicPrimitiveId, PortableLogicPrimitive>;

export const PORTABLE_LOGIC_PRIMITIVE_IDS = Object.keys(PORTABLE_LOGIC_PRIMITIVES) as PortableLogicPrimitiveId[];

export function lookupPortableLogicPrimitive(id: string): PortableLogicPrimitive | null {
  return Object.hasOwn(PORTABLE_LOGIC_PRIMITIVES, id)
    ? PORTABLE_LOGIC_PRIMITIVES[id as PortableLogicPrimitiveId]
    : null;
}

export function portableLogicSupportForTarget(
  id: PortableLogicPrimitiveId,
  target: PortableLogicTarget,
): PortableLogicSupport {
  const primitive = lookupPortableLogicPrimitive(id);
  if (!primitive) {
    throw new Error(`Unknown portable logic primitive '${id}'.`);
  }
  return primitive.targets[target];
}
