/**
 * Phase-2 denominator authority (census-v3).
 *
 * The ratchet denominator must distinguish real EXPRESSIONS from prose that
 * merely sits in a `value=` prop. Authoritative sources (conformance expr,
 * parsed embedded kern expression props, hand-authored Phase-2 fixtures) count
 * as EXPRESSION automatically. Legacy repo `.kern` `value=` props pass through
 * the census-v3 prose heuristic. Anything that cannot be classified fails
 * `DENOMINATOR_UNCLASSIFIED` — silent inclusion would let prose inflate the
 * ratchet denominator and hide migration gaps.
 *
 * Slice 0's corpus is entirely authoritative (hand-authored + conformance), so
 * the prose heuristic is present and unit-tested but not exercised by the seed;
 * it activates when the repo `.kern` corpus is ingested in a later slice.
 *
 * @typedef {{kind:'EXPRESSION', source:'authoritative'|'legacy-value-heuristic'}
 *   | {kind:'PROSE_NOT_EXPR', bucket:'sentence-punctuation'|'prose-symbol'|'identifier-code-label'|'title-case-label'|'bare-prose-words'}
 *   | {kind:'ESCAPED_ARTIFACT', reason:string}
 *   | {kind:'EXCLUDED_NONDETERMINISTIC', owner:string, reentryCondition:string}} DenominatorClass
 */

export const DISCRIMINATOR_VERSION = 'census-v3';

const AUTHORITATIVE_SOURCES = new Set(['conformance:expr', 'conformance:kern-props', 'hand-authored']);

/**
 * Classify a corpus case into its denominator class.
 * @param {{source:string, sourceKind:string}} item
 * @returns {DenominatorClass}
 */
export function classify(item) {
  if (AUTHORITATIVE_SOURCES.has(item.sourceKind)) {
    return { kind: 'EXPRESSION', source: 'authoritative' };
  }
  if (item.sourceKind === 'repo-kern:value-props') {
    return classifyValueProp(item.source);
  }
  throw new Error(`DENOMINATOR_UNCLASSIFIED: sourceKind=${item.sourceKind} source=${JSON.stringify(item.source)}`);
}

/**
 * Census-v3 prose-vs-expression heuristic for legacy `value=` prop strings.
 * Conservative: only strings that look like real JS expressions count as
 * EXPRESSION; everything that reads as prose/label is excluded with a bucket.
 * @param {string} raw
 * @returns {DenominatorClass}
 */
export function classifyValueProp(raw) {
  const s = String(raw).trim();
  if (s.length === 0) return { kind: 'PROSE_NOT_EXPR', bucket: 'bare-prose-words' };

  // Sentence punctuation: ends with sentence terminator or contains mid-sentence
  // comma+space prose that no expression would.
  if (/[.!?]$/.test(s) || /,\s+\w+\s+\w+/.test(s)) {
    return { kind: 'PROSE_NOT_EXPR', bucket: 'sentence-punctuation' };
  }

  // Expression markers: operators, calls, member access, literals, brackets.
  const hasExprMarker =
    /[(){}\[\]]/.test(s) ||
    /(===|!==|==|!=|<=|>=|&&|\|\||\?\?|\?\.|=>|\+\+|--|[-+*/%<>!~^&|])/.test(s) ||
    /\.\w/.test(s) ||
    /^['"`]/.test(s) ||
    /^-?\d/.test(s) ||
    /\b(true|false|null|undefined|new|typeof|void)\b/.test(s);

  if (hasExprMarker) {
    return { kind: 'EXPRESSION', source: 'legacy-value-heuristic' };
  }

  // No expression markers — classify the prose bucket.
  const words = s.split(/\s+/);
  if (/[^\x00-\x7F]/.test(s) || /[#@%§©®™]/.test(s)) {
    return { kind: 'PROSE_NOT_EXPR', bucket: 'prose-symbol' };
  }
  if (words.length === 1) {
    if (/^[A-Za-z_$][\w$]*$/.test(s)) {
      // A bare identifier-shaped token. Could be a variable reference, but with
      // no other expression marker it reads as a code-label in a value= prop.
      return { kind: 'PROSE_NOT_EXPR', bucket: 'identifier-code-label' };
    }
    return { kind: 'PROSE_NOT_EXPR', bucket: 'bare-prose-words' };
  }
  if (words.every((w) => /^[A-Z][a-z]*$/.test(w))) {
    return { kind: 'PROSE_NOT_EXPR', bucket: 'title-case-label' };
  }
  return { kind: 'PROSE_NOT_EXPR', bucket: 'bare-prose-words' };
}

/**
 * Bucket-count a set of cases for the denominator manifest.
 * @param {Array<{source:string, sourceKind:string}>} cases
 */
export function denominatorReport(cases) {
  const buckets = {
    'sentence-punctuation': 0,
    'prose-symbol': 0,
    'identifier-code-label': 0,
    'title-case-label': 0,
    'bare-prose-words': 0,
  };
  let expression = 0;
  let escaped = 0;
  for (const c of cases) {
    const cls = classify(c);
    if (cls.kind === 'EXPRESSION') expression += 1;
    else if (cls.kind === 'PROSE_NOT_EXPR') buckets[cls.bucket] += 1;
    else if (cls.kind === 'ESCAPED_ARTIFACT') escaped += 1;
  }
  return {
    version: 1,
    discriminatorVersion: DISCRIMINATOR_VERSION,
    rawOccurrences: cases.length,
    expressionDenominator: expression,
    proseNotExpr: Object.values(buckets).reduce((a, b) => a + b, 0),
    escapedArtifacts: escaped,
    buckets,
  };
}
