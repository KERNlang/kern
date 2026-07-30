import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { evaluateCoreContractOperation } from '../../packages/core/dist/core-contracts/semantics.js';
import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { loadCoveragePolicy } from './coverage.mjs';
import {
  migrateLegacyFunctionForPrerequisite,
} from './coverage-prerequisite.mjs';
import {
  canonicalProfileRowsForFunction,
  profileBlockersForFunction,
} from './coverage-profile.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM4148,
} from './coverage-residual-analysis-m4-148.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.canonical-surface-analysis.1';
const PUBLISHED_DIGEST = 'bca47b2e75cd13cbbaa3b54e7e98e92f515e44f15cf92e3edea8c8c6bf59dc1d';
const INPUT_COMMIT = '44ca4feda2901c16f79c7c5c40ede69394e60404';
const M4148_DIGEST = 'bf5b7c6886f7f114995f59d916f4a87ecc2ea3f7fffc5289448d7ebb32abde2f';
const M4148_INPUT_COMMIT = '4115914127dc627edf8348af8a487ac1beae941a';
const M4148_ASSIGNMENTS_DIGEST =
  'e953208c40e51714c3e0338455f67437fb6a6fda6c3f9fb42df0870dda003720';
const QUOTESOURCE_ID =
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource';
const QUOTESOURCE_SOURCE_DIGEST =
  'c32414ee7aa6f29d092dc21de5065f04c4054c54d070dd4d964763047170ee2f';
const SOURCE_URL = new URL(
  '../../examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
  import.meta.url,
);
const SUMMARY_URL = new URL('./canonical-surface-analysis-m4-149.json', import.meta.url);

const CURRENT_PREDICATE_TERMS = freezeTerms([
  { kind: 'less-than', right: ' ' },
  { kind: 'equals', right: '\u007f' },
  { kind: 'closed-range', lower: '\u0080', upper: '\u009f' },
  { kind: 'equals', right: '\u2028' },
  { kind: 'equals', right: '\u2029' },
  { kind: 'equals', right: '\ufeff' },
]);
const CANDIDATE_PREDICATE_TERMS = freezeTerms([
  { kind: 'less-than', right: ' ' },
  { kind: 'open-range', lower: '~', upper: '\u00a0' },
  { kind: 'open-range', lower: '\u2027', upper: '\u202a' },
  { kind: 'open-range', lower: '\ufefe', upper: '\uff00' },
]);

export const M4149_CURRENT_PREDICATE = renderPredicate(CURRENT_PREDICATE_TERMS);
export const M4149_CANDIDATE_PREDICATE = renderPredicate(CANDIDATE_PREDICATE_TERMS);

const BLOCKED_REASONS = [
  'if.properties.cond.expression.text.character-u007f',
  'if.properties.cond.expression.text.character-u0080',
  'if.properties.cond.expression.text.character-u009f',
  'if.properties.cond.expression.text.character-u2028',
  'if.properties.cond.expression.text.character-u2029',
  'if.properties.cond.expression.text.character-ufeff',
];
const SENTINELS = [
  { codePoint: 'U+007E', literal: '~', role: 'c1-lower-exclusive' },
  { codePoint: 'U+00A0', literal: '\\u00a0', role: 'c1-upper-exclusive' },
  { codePoint: 'U+2027', literal: '\\u2027', role: 'line-lower-exclusive' },
  { codePoint: 'U+202A', literal: '\\u202a', role: 'line-upper-exclusive' },
  { codePoint: 'U+FEFE', literal: '\\ufefe', role: 'bom-lower-exclusive' },
  { codePoint: 'U+FF00', literal: '\\uff00', role: 'bom-upper-exclusive' },
];
const EXPECTED_ASSIGNMENT = {
  id: QUOTESOURCE_ID,
  parameterRows: 2,
  profileRows: { nodes: 54, properties: 82, values: 932 },
  reasons: BLOCKED_REASONS,
  tool: 'canonicalizer',
};
const UNICODE_SCALAR_COUNT = 0x11_0000 - 0x800;

function fail(message) {
  throw new TypeError(`coverage M4.149 canonical-surface analysis rejection: ${message}`);
}

function assertPlainReceiptData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail('analysis data must contain only finite canonical numbers');
    }
    return;
  }
  if (typeof value !== 'object') fail('analysis data must contain only JSON values');
  if (seen.has(value)) fail('analysis data must not contain cycles or shared references');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail('analysis arrays must use the plain prototype');
    }
    const ownKeys = Reflect.ownKeys(value);
    const enumerableKeys = Object.keys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      ownKeys.some((key) => typeof key === 'symbol') ||
      ownKeys.length !== value.length + 1 ||
      enumerableKeys.length !== value.length ||
      lengthDescriptor === undefined ||
      lengthDescriptor.value !== value.length ||
      lengthDescriptor.enumerable ||
      lengthDescriptor.configurable ||
      !lengthDescriptor.writable
    ) {
      fail('analysis arrays must be dense and undecorated');
    }
    for (const [index, key] of enumerableKeys.entries()) {
      if (key !== String(index)) fail('analysis arrays must contain canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !descriptor.configurable ||
        !descriptor.writable ||
        !('value' in descriptor)
      ) {
        fail('analysis arrays must contain plain data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    fail('analysis objects must use the plain prototype');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail('analysis objects must not contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !descriptor.configurable ||
      !descriptor.writable ||
      !('value' in descriptor)
    ) {
      fail('analysis objects must contain plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function coreBoolean(operationId, left, right) {
  const result = evaluateCoreContractOperation(operationId, [left, right]);
  if (typeof result !== 'boolean') fail(`${operationId} must return a boolean`);
  return result;
}

function freezeTerms(terms) {
  return Object.freeze(terms.map((term) => Object.freeze(term)));
}

function kernTextLiteral(value) {
  const codePoint = value.codePointAt(0);
  if (codePoint === undefined || Array.from(value).length !== 1) {
    fail('predicate terms must contain one character');
  }
  if (codePoint >= 0x20 && codePoint <= 0x7e) return JSON.stringify(value);
  return `"\\u${codePoint.toString(16).padStart(4, '0')}"`;
}

function renderPredicateTerm(term) {
  if (term.kind === 'less-than') return `c < ${kernTextLiteral(term.right)}`;
  if (term.kind === 'equals') return `c == ${kernTextLiteral(term.right)}`;
  if (term.kind === 'closed-range') {
    return `(c >= ${kernTextLiteral(term.lower)} && c <= ${kernTextLiteral(term.upper)})`;
  }
  if (term.kind === 'open-range') {
    return `(c > ${kernTextLiteral(term.lower)} && c < ${kernTextLiteral(term.upper)})`;
  }
  fail('predicate term kind must be closed');
}

function renderPredicate(terms) {
  return terms.map(renderPredicateTerm).join(' || ');
}

function evaluatePredicateTerms(terms, value) {
  return terms.some((term) => {
    if (term.kind === 'less-than') {
      return coreBoolean('String.lessThan', value, term.right);
    }
    if (term.kind === 'equals') return coreBoolean('String.equals', value, term.right);
    if (term.kind === 'closed-range') {
      return coreBoolean('String.greaterThanOrEqual', value, term.lower) &&
        coreBoolean('String.lessThanOrEqual', value, term.upper);
    }
    if (term.kind === 'open-range') {
      return coreBoolean('String.greaterThan', value, term.lower) &&
        coreBoolean('String.lessThan', value, term.upper);
    }
    fail('predicate term kind must be closed');
  });
}

function evaluateRenderedPredicate(predicate, value) {
  if (predicate === M4149_CURRENT_PREDICATE) {
    return evaluatePredicateTerms(CURRENT_PREDICATE_TERMS, value);
  }
  if (predicate === M4149_CANDIDATE_PREDICATE) {
    return evaluatePredicateTerms(CANDIDATE_PREDICATE_TERMS, value);
  }
  fail('predicate must be an exact mechanically rendered contract');
}

function scalarCodePoint(value) {
  if (typeof value !== 'string') fail('candidate input must be a string');
  const characters = Array.from(value);
  if (characters.length !== 1) fail('candidate input must contain exactly one character');
  const codePoint = characters[0].codePointAt(0);
  if (
    codePoint === undefined ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    fail('candidate input must be one Unicode scalar value');
  }
  return codePoint;
}

export function evaluateQuotesourcePredicateM4149(predicate, value) {
  scalarCodePoint(value);
  return evaluateRenderedPredicate(predicate, value);
}

export function classifyQuotesourceCharacterM4149(value) {
  const codePoint = scalarCodePoint(value);
  const current = evaluateRenderedPredicate(M4149_CURRENT_PREDICATE, value);
  const candidate = evaluateRenderedPredicate(M4149_CANDIDATE_PREDICATE, value);
  return { candidate, codePoint, current };
}

function exactSourceRoot() {
  const path = fileURLToPath(SOURCE_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || realpathSync(path) !== path) {
    fail('quotesource owner must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  if (sha256(source) !== QUOTESOURCE_SOURCE_DIGEST) {
    fail('quotesource owner must match the exact M4.148 source');
  }
  const parsed = parseDocumentWithDiagnostics(source.toString('utf8'));
  if (parsed.diagnostics.some(({ severity }) => severity === 'error')) {
    fail('quotesource owner must remain parse-clean');
  }
  const roots = parsed.root.children ?? [];
  const matches = roots
    .map((root, ordinal) => ({ ordinal, root }))
    .filter(({ root }) => root.type === 'fn' && root.props?.name === 'quotesource');
  if (matches.length !== 1 || matches[0].ordinal !== 5) {
    fail('quotesource owner identity must remain exact');
  }
  return matches[0].root;
}

function predicateMatches(root, predicate) {
  const matches = [];
  function visit(node) {
    if (node.type === 'if' && node.props?.cond === predicate) matches.push(node);
    for (const child of node.children ?? []) visit(child);
  }
  visit(root);
  return matches;
}

function profileEvidence(root) {
  const { parameters, root: migrated } = migrateLegacyFunctionForPrerequisite(root);
  const coveragePolicy = loadCoveragePolicy();
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  const profileRows = canonicalProfileRowsForFunction(
    migrated,
    canonicalizerPolicy.kirLimits,
  );
  const blockers = profileBlockersForFunction(
    migrated,
    coveragePolicy.base,
    canonicalizerPolicy.profileLimits,
    profileRows,
  );
  return { blockers, parameterRows: parameters.length, profileRows };
}

function exhaustiveEquivalence() {
  let scalarValuesEvaluated = 0;
  for (let codePoint = 0; codePoint <= 0x10_ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    const result = classifyQuotesourceCharacterM4149(String.fromCodePoint(codePoint));
    scalarValuesEvaluated += 1;
    if (result.current !== result.candidate) {
      fail(`candidate predicate diverges at U+${codePoint.toString(16).padStart(4, '0')}`);
    }
  }
  if (scalarValuesEvaluated !== UNICODE_SCALAR_COUNT) {
    fail('candidate predicate must evaluate every Unicode scalar value exactly once');
  }
  return { mismatches: 0, scalarValuesEvaluated };
}

function publishedHandoff(value) {
  assertPlainReceiptData(value);
  if (value === null || Array.isArray(value) || value.format !== FORMAT) {
    fail(`published format must be ${FORMAT}`);
  }
  const digest = sha256(canonicalBytes(value));
  if (digest !== PUBLISHED_DIGEST) fail('receipt must match the exact published M4.149 analysis');
  return { digest, inputCommit: INPUT_COMMIT, record: structuredClone(value) };
}

export function measureCanonicalizerSurfaceAnalysisM4149() {
  const m4148 = loadPublishedCanonicalizerResidualAnalysisM4148();
  if (
    m4148.digest !== M4148_DIGEST ||
    m4148.inputCommit !== M4148_INPUT_COMMIT ||
    m4148.record.assignmentsDigest !== M4148_ASSIGNMENTS_DIGEST ||
    m4148.record.assignments.length !== 1 ||
    !isDeepStrictEqual(m4148.record.assignments[0], EXPECTED_ASSIGNMENT)
  ) {
    fail('M4.148 input handoff must remain exact');
  }

  const sourceRoot = exactSourceRoot();
  const oldMatches = predicateMatches(sourceRoot, M4149_CURRENT_PREDICATE);
  if (oldMatches.length !== 1) fail('current quotesource predicate must occur exactly once');
  if (predicateMatches(sourceRoot, M4149_CANDIDATE_PREDICATE).length !== 0) {
    fail('candidate predicate must not already exist in M4.149 source');
  }
  const currentEvidence = profileEvidence(sourceRoot);
  if (
    currentEvidence.parameterRows !== EXPECTED_ASSIGNMENT.parameterRows ||
    !isDeepStrictEqual(currentEvidence.profileRows, EXPECTED_ASSIGNMENT.profileRows) ||
    !isDeepStrictEqual(currentEvidence.blockers, BLOCKED_REASONS)
  ) {
    fail('current quotesource profile evidence must reproduce M4.148');
  }

  const candidateRoot = structuredClone(sourceRoot);
  const candidateMatches = predicateMatches(candidateRoot, M4149_CURRENT_PREDICATE);
  if (candidateMatches.length !== 1) fail('candidate rewrite target must remain unique');
  candidateMatches[0].props.cond = M4149_CANDIDATE_PREDICATE;
  const candidateEvidence = profileEvidence(candidateRoot);
  if (
    candidateEvidence.parameterRows !== EXPECTED_ASSIGNMENT.parameterRows ||
    !isDeepStrictEqual(candidateEvidence.profileRows, EXPECTED_ASSIGNMENT.profileRows) ||
    candidateEvidence.blockers.length !== 0
  ) {
    fail('candidate rewrite must clear only the canonical-surface blockers');
  }

  const equivalence = exhaustiveEquivalence();
  const selectedNextAction = {
    action: 'replace-exact-quotesource-predicate',
    id: 'quotesource-neighbor-sentinel-rewrite',
    milestone: 'M4.150',
    source: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    witness: QUOTESOURCE_ID,
  };
  const analysis = {
    baseline: {
      assignmentsDigest: M4148_ASSIGNMENTS_DIGEST,
      blockerCount: BLOCKED_REASONS.length,
      m4148Digest: M4148_DIGEST,
      m4148InputCommit: M4148_INPUT_COMMIT,
      quotesourceId: QUOTESOURCE_ID,
      sourceDigest: QUOTESOURCE_SOURCE_DIGEST,
    },
    candidate: {
      equivalence,
      id: selectedNextAction.id,
      parameterRows: candidateEvidence.parameterRows,
      predicate: M4149_CANDIDATE_PREDICATE,
      profileBlockers: candidateEvidence.blockers,
      profileRows: candidateEvidence.profileRows,
      runtimeContract: 'portable-unicode-code-point-order',
      sentinels: structuredClone(SENTINELS),
    },
    current: {
      blockedReasons: structuredClone(BLOCKED_REASONS),
      parameterRows: currentEvidence.parameterRows,
      predicate: M4149_CURRENT_PREDICATE,
      profileRows: currentEvidence.profileRows,
    },
    format: FORMAT,
    selectedNextAction,
  };
  assertPlainReceiptData(analysis);
  return analysis;
}

export function validatePublishedCanonicalizerSurfaceAnalysisM4149(value) {
  return publishedHandoff(value);
}

export function loadPublishedCanonicalizerSurfaceAnalysisM4149(summaryUrl = SUMMARY_URL) {
  const path = fileURLToPath(summaryUrl);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || realpathSync(path) !== path) {
    fail('published receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('published receipt must contain JSON');
  }
  const result = publishedHandoff(parsed);
  if (!source.equals(canonicalBytes(result.record))) {
    fail('published receipt must use canonical JSON bytes');
  }
  return result;
}

function isDirectInvocation(invokedPath) {
  if (invokedPath === undefined || invokedPath === '-') return false;
  const resolvedPath = resolve(invokedPath);
  if (lstatSync(resolvedPath, { throwIfNoEntry: false }) === undefined) return false;
  return realpathSync(resolvedPath) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation(process.argv[1])) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerSurfaceAnalysisM4149());
}
