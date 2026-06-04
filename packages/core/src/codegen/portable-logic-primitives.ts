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
  | 'logic.firstTruthy'
  | 'time.epochMs'
  | 'logic.not'
  | 'number.clamp'
  | 'object.keys'
  | 'object.values'
  | 'object.entries'
  | 'object.merge'
  | 'object.omit'
  | 'object.pick'
  | 'string.trim'
  | 'string.split'
  | 'string.replaceFirst'
  | 'string.replaceAll';
export type PortableLogicTarget = 'ts' | 'python' | 'go';
export type PortableLogicSupport = 'stable' | 'preview' | 'unsupported';
export type PortableLogicPurity = 'pure' | 'reads-time';
export type PortableLogicIntent = 'semantic-gap' | 'host-pattern' | 'language-operator';

export interface PortableLogicPrimitive {
  id: PortableLogicPrimitiveId;
  description: string;
  purity: PortableLogicPurity;
  intent: PortableLogicIntent;
  hostPatterns: readonly string[];
  portabilityNotes: readonly string[];
  operatorRationale?: string;
  targets: Record<PortableLogicTarget, PortableLogicSupport>;
}

export const PORTABLE_LOGIC_PRIMITIVES = {
  'collection.has': {
    id: 'collection.has',
    description: 'Membership test over a constructed collection, e.g. JS new Set(xs).has(x).',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['new Set(xs).has(x)'],
    portabilityNotes: ['Membership intent is explicit; target helpers own Set/list membership mechanics.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'logic.firstTruthy': {
    id: 'logic.firstTruthy',
    description: 'Ordered truthy fallback selection, e.g. JS a || b || c and Python a or b or c.',
    purity: 'pure',
    intent: 'language-operator',
    hostPatterns: ['a || b || c', 'a or b or c'],
    portabilityNotes: [
      'Uses host truthiness: false, 0, empty string, null/None, and undefined fall through; empty collections are target-specific because [] and {} are truthy in JS while empty lists/dicts are falsy in Python.',
    ],
    operatorRationale: 'KERN firstTruthy names this common fallback operator chain as portable intent.',
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'time.epochMs': {
    id: 'time.epochMs',
    description: 'Epoch-milliseconds extraction from a date/time value, e.g. JS new Date(x).getTime().',
    // Pure because the source value is already supplied; this is not Date.now().
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['new Date(x).getTime()'],
    portabilityNotes: ['Only value-to-epoch conversion is portable; current time stays target-native.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'logic.not': {
    id: 'logic.not',
    description: 'Boolean negation over the portable truthiness domain, e.g. JS !x.',
    purity: 'pure',
    intent: 'language-operator',
    hostPatterns: ['!x', '!!x'],
    portabilityNotes: ['Registered for review visibility over portable truthiness, not as a new KERN operator.'],
    operatorRationale: 'KERN already has expression negation; this entry documents target truthiness parity only.',
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'number.clamp': {
    id: 'number.clamp',
    description: 'Bounds a numeric value between inclusive low/high limits, e.g. Math.max(lo, Math.min(hi, value)).',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['Math.max(lo, Math.min(hi, value))', 'Math.min(hi, Math.max(lo, value))'],
    portabilityNotes: ['Bounds must be side-effect-free expressions because host clamp idioms evaluate them directly.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'object.keys': {
    id: 'object.keys',
    description: 'Own enumerable key extraction for portable record objects, e.g. JS Object.keys(obj).',
    purity: 'pure',
    intent: 'host-pattern',
    hostPatterns: ['Object.keys(obj)'],
    portabilityNotes: ['Own-property order is target-normalized for numeric-like keys before string keys.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'object.values': {
    id: 'object.values',
    description: 'Own enumerable value extraction for portable record objects, e.g. JS Object.values(obj).',
    purity: 'pure',
    intent: 'host-pattern',
    hostPatterns: ['Object.values(obj)'],
    portabilityNotes: ['Own-property order follows the matching object.keys primitive.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'object.entries': {
    id: 'object.entries',
    description: 'Own enumerable entry extraction for portable record objects, e.g. JS Object.entries(obj).',
    purity: 'pure',
    intent: 'host-pattern',
    hostPatterns: ['Object.entries(obj)'],
    portabilityNotes: ['Entries preserve JS key order and return array-like key/value pairs.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'object.merge': {
    id: 'object.merge',
    description: 'Shallow own-enumerable record merge, e.g. JS Object.assign({}, a, b) or { ...a, ...b }.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['Object.assign({}, a, b)', '{ ...a, ...b }'],
    portabilityNotes: ['Merge is shallow, non-mutating, left-to-right, and duplicate keys are last-write-wins.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'object.omit': {
    id: 'object.omit',
    description: 'Shallow own string-key record omission, e.g. JS destructuring assignment with rest parameters.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['const { a, b, ...rest } = obj'],
    portabilityNotes: ['Omit is shallow, non-mutating, and preserves falsy values.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'object.pick': {
    id: 'object.pick',
    description: 'Shallow own string-key record selection, e.g. JS Object.fromEntries(keys.map(k => [k, obj[k]]))',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['Object.fromEntries(keys.map(k => [k, obj[k]]))'],
    portabilityNotes: ['Pick preserves key order and includes missing keys as null (TS) or None (Python).'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'string.trim': {
    id: 'string.trim',
    description: 'String boundary-whitespace trimming, e.g. JS value.trim().',
    purity: 'pure',
    intent: 'host-pattern',
    hostPatterns: ['value.trim()'],
    portabilityNotes: ['Whitespace trimming follows the target-normalized portable string domain.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'string.split': {
    id: 'string.split',
    description:
      'String splitting by a non-regex separator; Python lowering must emulate JS limit as result-length truncation.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['value.split(separator)', 'value.split(separator, limit)'],
    portabilityNotes: ['Regex separators and unresolved empty separators stay outside the portable primitive.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'string.replaceFirst': {
    id: 'string.replaceFirst',
    description:
      'First occurrence string replacement with non-regex search and literal replacement text, e.g. JS value.replace(a, b).',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['value.replace(search, replacement)'],
    portabilityNotes: ['Replacement callbacks, regex searches, and substitution-token replacements are excluded.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'string.replaceAll': {
    id: 'string.replaceAll',
    description:
      'All occurrences string replacement with non-regex search and literal replacement text, e.g. JS value.replaceAll(a, b).',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['value.replaceAll(search, replacement)'],
    portabilityNotes: ['Replacement callbacks, regex searches, and substitution-token replacements are excluded.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
} as const satisfies Record<PortableLogicPrimitiveId, PortableLogicPrimitive>;

export function validatePortableLogicPrimitiveRegistry(
  primitives: Record<string, PortableLogicPrimitive> = PORTABLE_LOGIC_PRIMITIVES,
): void {
  for (const [id, primitive] of Object.entries(primitives)) {
    if (id !== primitive.id) {
      throw new Error(`Portable logic primitive key '${id}' does not match id '${primitive.id}'.`);
    }
    const idSegments = id.split('.').map((segment) => segment.toLowerCase());
    if (
      idSegments.some((segment) => segment === 'nullish' || segment === 'coalesce' || segment === 'nullishcoalesce')
    ) {
      throw new Error(`Portable logic primitive '${id}' duplicates existing language nullish/coalesce syntax.`);
    }
    if (primitive.hostPatterns.length === 0) {
      throw new Error(`Portable logic primitive '${id}' must declare at least one host pattern.`);
    }
    if (primitive.portabilityNotes.length !== 1) {
      throw new Error(`Portable logic primitive '${id}' must declare exactly one portability note.`);
    }
    if (primitive.intent === 'language-operator' && !primitive.operatorRationale) {
      throw new Error(`Portable logic primitive '${id}' needs an operator rationale.`);
    }
    if (primitive.intent !== 'language-operator' && primitive.operatorRationale) {
      throw new Error(
        `Portable logic primitive '${id}' has an operator rationale but is not language-operator intent.`,
      );
    }
  }
}

validatePortableLogicPrimitiveRegistry();

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
