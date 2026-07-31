import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  loadPublishedCanonicalizerSurfaceAnalysisM4149,
  M4149_CANDIDATE_PREDICATE,
  M4149_CURRENT_PREDICATE,
} from './canonical-surface-analysis-m4-149.mjs';
import { verifyCanonicalizerComposition } from './composition.mjs';
import {
  M4150_CANDIDATE_PREDICATE,
  M4150_CURRENT_PREDICATE,
  M4150_EXPRESSION_HELPERS_DIGEST,
  PRE_M4150_EXPRESSION_HELPERS_DIGEST,
  QUOTESOURCE_M4150_PATH,
  readExactM4150ExpressionHelpers,
  reconstructPreM4150ExpressionHelpers,
} from './quotesource-rewrite-m4-150-target.mjs';

const FORMAT = 'kern.kir-canonicalizer.quotesource-rewrite.1';
const M4149_DIGEST = 'bca47b2e75cd13cbbaa3b54e7e98e92f515e44f15cf92e3edea8c8c6bf59dc1d';
const M4149_INPUT_COMMIT = '44ca4feda2901c16f79c7c5c40ede69394e60404';
const M4150_INPUT_COMMIT = '864017b4200a6a3bc51b8d9e30cc61145eef6951';
const COMPOSITE_DIGEST = 'd3671c6647993e13cc09e3ebb9ffb18a20009b27761d2d8bb29a2a64d093b8c2';
const COMPOSITION_RECORD_DIGEST =
  '89f0b37cd9ca2e40bfe4fd3998816990720ff6306001c1f93289e3b80bb977a0';
const QUOTESOURCE_ID = `${QUOTESOURCE_M4150_PATH}#5:quotesource`;

function fail(message) {
  throw new TypeError(`coverage M4.150 quotesource rewrite rejection: ${message}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
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

export function assertM4150QuotesourceRewrite() {
  const m4149 = loadPublishedCanonicalizerSurfaceAnalysisM4149();
  if (
    m4149.digest !== M4149_DIGEST ||
    m4149.inputCommit !== M4149_INPUT_COMMIT ||
    m4149.record.selectedNextAction?.id !== 'quotesource-neighbor-sentinel-rewrite' ||
    m4149.record.selectedNextAction?.action !== 'replace-exact-quotesource-predicate' ||
    m4149.record.selectedNextAction?.milestone !== 'M4.150' ||
    m4149.record.candidate?.predicate !== M4149_CANDIDATE_PREDICATE ||
    m4149.record.current?.predicate !== M4149_CURRENT_PREDICATE ||
    M4149_CANDIDATE_PREDICATE !== M4150_CANDIDATE_PREDICATE ||
    M4149_CURRENT_PREDICATE !== M4150_CURRENT_PREDICATE
  ) {
    fail('M4.149 input must authorize the exact predicate rewrite');
  }
  const source = readExactM4150ExpressionHelpers();
  reconstructPreM4150ExpressionHelpers(source);
  const parsed = parseDocumentWithDiagnostics(source.toString('utf8'));
  if (
    !Array.isArray(parsed.diagnostics) ||
    parsed.diagnostics.some(({ severity }) => severity === 'error')
  ) {
    fail('current expression-helper source must remain parse-clean');
  }
  const roots = parsed.root.children ?? [];
  const root = roots[5];
  if (root?.type !== 'fn' || root.props?.name !== 'quotesource') {
    fail('quotesource owner must remain exact at function ordinal 5');
  }
  if (
    predicateMatches(root, M4149_CURRENT_PREDICATE).length !== 0 ||
    predicateMatches(root, M4149_CANDIDATE_PREDICATE).length !== 1
  ) {
    fail('quotesource must contain only the exact M4.149 candidate predicate');
  }
  const composition = verifyCanonicalizerComposition();
  const expressionMember = composition.record.members[0];
  if (
    expressionMember.path !== QUOTESOURCE_M4150_PATH ||
    expressionMember.sha256 !== M4150_EXPRESSION_HELPERS_DIGEST ||
    composition.record.composite.sha256 !== COMPOSITE_DIGEST ||
    digest(readFileSync(new URL('./composition.json', import.meta.url))) !==
      COMPOSITION_RECORD_DIGEST
  ) {
    fail('canonicalizer composition must authenticate the exact M4.150 source');
  }
  return {
    format: FORMAT,
    input: {
      m4149Digest: M4149_DIGEST,
      m4149InputCommit: M4149_INPUT_COMMIT,
      m4150InputCommit: M4150_INPUT_COMMIT,
    },
    parameterMigration: {
      completeFunctions: 1,
      completeTools: 1,
      migratedParameterRows: 2,
      witnesses: [{
        id: QUOTESOURCE_ID,
        parameterRows: 2,
        profileRows: { nodes: 54, properties: 82, values: 932 },
        tool: 'canonicalizer',
      }],
    },
    selectedNextAction: {
      action: 'consume-exact-parameter-queue',
      milestone: 'M4.151',
      witness: QUOTESOURCE_ID,
    },
    source: {
      afterDigest: M4150_EXPRESSION_HELPERS_DIGEST,
      beforeDigest: PRE_M4150_EXPRESSION_HELPERS_DIGEST,
      path: QUOTESOURCE_M4150_PATH,
      predicate: M4149_CANDIDATE_PREDICATE,
    },
  };
}
