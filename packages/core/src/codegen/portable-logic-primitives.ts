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
  | 'collection.count'
  | 'collection.filter'
  | 'collection.compact'
  | 'collection.pluck'
  | 'collection.take'
  | 'collection.drop'
  | 'collection.slice'
  | 'collection.reverse'
  | 'collection.at'
  | 'collection.join'
  | 'collection.concat'
  | 'collection.includes'
  | 'collection.indexOf'
  | 'collection.lastIndexOf'
  | 'collection.sort'
  | 'collection.uniqueBy'
  | 'collection.groupBy'
  | 'collection.partition'
  | 'collection.indexBy'
  | 'collection.countBy'
  | 'logic.firstTruthy'
  | 'logic.coalesce'
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
  | 'string.replaceAll'
  | 'logic.firstDefined'
  | 'string.coerce';
export type PortableLogicTarget = 'ts' | 'python' | 'go';
export type PortableLogicSupport = 'stable' | 'preview' | 'unsupported';
export type GoPortableLogicSupport = 'preview' | 'unsupported';
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
  targets: {
    ts: PortableLogicSupport;
    python: PortableLogicSupport;
    go: GoPortableLogicSupport;
  };
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
  'collection.count': {
    id: 'collection.count',
    description: 'Collection cardinality, optionally after a predicate, e.g. JS xs.length or xs.filter(pred).length.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.length', 'xs.filter(x => pred).length', 'len(xs)'],
    portabilityNotes: ['Count is non-mutating; filtered counts evaluate the predicate once per item in source order.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.filter': {
    id: 'collection.filter',
    description: 'Filters collection elements by a portable predicate while preserving source order.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.filter(x => pred)', '[x for x in xs if pred]'],
    portabilityNotes: [
      'Predicate v1 supports eq, neq, gt, gte, and over bool/number/string/null scalar values; object/list equality is intentionally outside v1. Missing paths and numeric comparison semantics are target-normalized.',
    ],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.compact': {
    id: 'collection.compact',
    description: 'Filters a collection by KERN portable truthiness while preserving source order.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.filter(Boolean)'],
    portabilityNotes: [
      'Drops null/None/undefined, false, numeric zero, NaN, and empty string; keeps arrays and objects as truthy.',
    ],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.pluck': {
    id: 'collection.pluck',
    description: 'Projects a dotted element path from each collection item.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.map(x => x.path)', '[x.path for x in xs]'],
    portabilityNotes: ['Route lowering uses safe dotted lookup and returns null/None for missing path segments.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.take': {
    id: 'collection.take',
    description: 'Takes the first N collection elements.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.slice(0, n)', 'xs[:n]'],
    portabilityNotes: ['Route lowering requires a non-negative integer literal to avoid target slicing divergence.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.drop': {
    id: 'collection.drop',
    description: 'Drops the first N collection elements.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.slice(n)', 'xs[n:]'],
    portabilityNotes: ['Route lowering requires a non-negative integer literal to avoid target slicing divergence.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.slice': {
    id: 'collection.slice',
    description: 'Copies a half-open collection range without mutating the source.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.slice(start, end)', 'xs[start:end]'],
    portabilityNotes: ['Route lowering requires non-negative integer literal bounds and clamps out-of-range values.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.reverse': {
    id: 'collection.reverse',
    description: 'Returns collection elements in reverse order without mutating the source.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['[...xs].reverse()', 'xs[::-1]'],
    portabilityNotes: ['Source collections are copied before reversal so route logic cannot mutate request data.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.at': {
    id: 'collection.at',
    description: 'Reads an element by zero-based index and returns null/None when out of range.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['index < xs.length ? xs[index] : null', 'xs[index] if index < len(xs) else None'],
    portabilityNotes: ['Route lowering requires a non-negative integer literal index; negative indexing is deferred.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.join': {
    id: 'collection.join',
    description: 'Joins scalar/null collection elements into a string with a separator.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.join(separator)', 'separator.join(str(x) for x in xs)'],
    portabilityNotes: [
      'Route lowering supports list receivers with scalar/null elements only; null slots become empty strings and booleans use JS lowercase spelling.',
    ],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.concat': {
    id: 'collection.concat',
    description: 'Concatenates two lists without mutating either source list.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.concat(ys)', '[...xs, ...ys]', 'list(xs) + list(ys)'],
    portabilityNotes: [
      'Route lowering supports exactly one list-valued with= operand; scalar concat and varargs are deferred.',
    ],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.includes': {
    id: 'collection.includes',
    description: 'Tests whether a list contains a JSON scalar/null value using JS SameValueZero equality.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.includes(value)'],
    portabilityNotes: [
      'Route lowering supports scalar/null search values only, with type-sensitive bool/number/string/null comparison and NaN matching NaN.',
    ],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.indexOf': {
    id: 'collection.indexOf',
    description: 'Returns the first index of a JSON scalar/null value or -1 when absent.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.indexOf(value)'],
    portabilityNotes: [
      'Route lowering supports scalar/null search values only and mirrors JS strict equality; NaN never matches.',
    ],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.lastIndexOf': {
    id: 'collection.lastIndexOf',
    description: 'Returns the last index of a JSON scalar/null value or -1 when absent.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.lastIndexOf(value)'],
    portabilityNotes: [
      'Route lowering supports scalar/null search values only and mirrors JS strict equality; from= remains deferred.',
    ],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.sort': {
    id: 'collection.sort',
    description: 'Immutable collection sort with optional comparator.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['[...xs].sort()', '[...xs].sort((a, b) => compare)', 'sorted(xs)'],
    portabilityNotes: [
      'Default sort follows JS lexicographic string ordering; comparator sort uses the declared two-item comparison expression.',
    ],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.uniqueBy': {
    id: 'collection.uniqueBy',
    description: 'Unique collection elements by a selector key.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.uniqueBy(x => x.id)'],
    portabilityNotes: ['Evaluates a scalar/hashable selector once per item; first-wins semantics.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.groupBy': {
    id: 'collection.groupBy',
    description: 'Groups collection elements by a selector key.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.groupBy(x => x.type)'],
    portabilityNotes: ['Groups items into source-order buckets by scalar/hashable selector key.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.partition': {
    id: 'collection.partition',
    description: 'Partitions collection elements into pass and fail arrays based on a predicate.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.partition(x => pred)'],
    portabilityNotes: ['Splits items into two lists based on predicate evaluations; type= denotes the element type.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.indexBy': {
    id: 'collection.indexBy',
    description: 'Indexes collection elements by a selector key.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.indexBy(x => x.id)'],
    portabilityNotes: ['Indexes items by scalar/hashable selector key with last-write-wins semantics.'],
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'collection.countBy': {
    id: 'collection.countBy',
    description: 'Counts collection elements by a selector key.',
    purity: 'pure',
    intent: 'semantic-gap',
    hostPatterns: ['xs.countBy(x => x.type)'],
    portabilityNotes: ['Counts occurrences of each scalar/hashable selector key as integers.'],
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
  'logic.coalesce': {
    id: 'logic.coalesce',
    description: 'Ordered nullish fallback selection that preserves false, zero, and empty string.',
    purity: 'pure',
    intent: 'language-operator',
    hostPatterns: ['a ?? b ?? c'],
    portabilityNotes: ['Uses null/None-only fallback; undefined is normalized to null only at target boundaries.'],
    operatorRationale: 'KERN coalesce names the portable nullish fallback operator chain for body and route lowering.',
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
  'logic.firstDefined': {
    id: 'logic.firstDefined',
    description: 'First defined (non-null/non-undefined) value selection.',
    purity: 'pure',
    intent: 'language-operator',
    hostPatterns: ['a ?? b'],
    portabilityNotes: ['Returns the first value that is not null or undefined.'],
    operatorRationale: 'Names the nullish coalescing fallback intent.',
    targets: { ts: 'stable', python: 'stable', go: 'unsupported' },
  },
  'string.coerce': {
    id: 'string.coerce',
    description: 'Portable scalar-to-string coercion for null, booleans, strings, and numbers.',
    purity: 'pure',
    intent: 'language-operator',
    hostPatterns: ['String(value)', '_kern_fmt(value)'],
    portabilityNotes: ['Null becomes "null", booleans use lowercase spelling, strings pass through, and numbers use JS decimal text.'],
    operatorRationale: 'String coercion is a host operator in TS/Python; KERN documents the expression-v1 subset explicitly.',
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
      id !== 'logic.coalesce' &&
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
