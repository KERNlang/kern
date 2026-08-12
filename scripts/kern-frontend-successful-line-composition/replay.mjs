import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

import { BUILTIN_ATTESTATION_FIXTURES } from '../kern-frontend-builtin-node-type-attestation/fixtures.mjs';
import { COMMENT_BOUNDARY_FIXTURES } from '../kern-frontend-comment-boundary/fixtures.mjs';
import { EVOLVED_HINT_FIXTURES } from '../kern-frontend-evolved-hints/fixtures.mjs';
import { GENERIC_PROPERTY_ADMISSION_FIXTURES } from '../kern-frontend-generic-property-admission/fixtures.mjs';
import { GENERIC_PROPERTY_LOOP_FIXTURES } from '../kern-frontend-generic-property-loop/fixtures.mjs';
import { GENERIC_PROPERTY_STYLE_THEME_DIAGNOSTIC_FIXTURES } from '../kern-frontend-generic-property-style-theme-diagnostics/fixtures.mjs';
import { GENERIC_PROPERTY_STYLE_THEME_FIXTURES } from '../kern-frontend-generic-property-style-theme/fixtures.mjs';
import { GENERIC_PROPERTY_THEME_REFS_FIXTURES } from '../kern-frontend-generic-property-theme-refs/fixtures.mjs';
import { INDENTATION_FIXTURES } from '../kern-frontend-indentation/fixtures.mjs';
import {
  KEYWORD_HANDLER_EDGE_FIXTURES,
  KEYWORD_HANDLER_FALLBACK_FIXTURES,
  KEYWORD_HANDLER_FIXTURES,
  KEYWORD_HANDLER_NUMERIC_FIXTURES,
} from '../kern-frontend-keyword-handlers/fixtures.mjs';
import { knownNodeWarningTruthTableFixtures } from '../kern-frontend-known-node-warning/fixtures.mjs';
import { loadFrontendKnownNodeWarningPolicy } from '../kern-frontend-known-node-warning/policy.mjs';
import { LEXICAL_FIXTURES } from '../kern-frontend-lexical/fixtures.mjs';
import { MUTABLE_REGISTRY_SNAPSHOT_FIXTURES } from '../kern-frontend-mutable-node-type-registry-snapshot/fixtures.mjs';
import { NODE_TYPE_TOKEN_ADMISSION_FIXTURES } from '../kern-frontend-node-type-token-admission/fixtures.mjs';
import { RETAINED_TOKEN_STREAM_FIXTURES } from '../kern-frontend-retained-token-stream/fixtures.mjs';
import { PARITY_FIXTURES as STITCHER_FIXTURES } from '../kern-frontend-stitcher/fixtures.mjs';
import { PARITY_FIXTURES as TOKENIZER_FIXTURES } from '../kern-frontend-tokenizer/fixtures.mjs';
import { WHITESPACE_TRIM_FIXTURES } from '../kern-frontend-whitespace-trim/fixtures.mjs';

const UNSUPPORTED_LEADING_WHITESPACE = /[\t\v\f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/u;
const BOUNDARY_EXCLUSIONS = new Map([
  ['M4.161/builtin-node-type-attestation/builtin-last', 'document-body-validation'],
  ['M4.170/keyword-handlers/while-raw', 'document-body-validation'],
  ['M4.170/keyword-handlers/return-raw', 'document-body-validation'],
  ['M4.170/keyword-handler-fallbacks/return-key-value-noop', 'document-body-validation'],
  ['M4.170/keyword-handlers/import-named', 'post-line-import-canonicalization'],
  ['M4.170/keyword-handler-edges/fn-nested-signature-and-dynamic-props', 'unsafe-inherited-property'],
  ['M4.170/keyword-handler-edges/import-foreign-registry', 'unsafe-inherited-property'],
  ['M4.170/keyword-handler-edges/let-top-level-assignment-after-arrow-type', 'minified-multiline-expansion'],
  ['M4.170/keyword-handler-edges/params-nested-comma-defaults', 'minified-multiline-expansion'],
  ['M4.170/keyword-handlers/throw-raw', 'minified-multiline-expansion'],
  ['M4.170/keyword-handlers/do-raw', 'minified-multiline-expansion'],
  ['M4.170/keyword-handlers/if-raw', 'minified-multiline-expansion'],
]);
const EXPECTED_PREDECESSOR_EXCLUSIONS = new Map([
  ['M4.153/tokenizer/unicode-aggregates', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.153/tokenizer/single-quoted-escapes', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.153/tokenizer/double-quoted-escapes', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.153/tokenizer/nested-expression', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.153/tokenizer/expression-nbsp-trim', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.153/tokenizer/expression-ideographic-space-trim', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.153/tokenizer/expression-bom-trim', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.153/tokenizer/style-quotes', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.153/tokenizer/numeric-family', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.153/tokenizer/invalid-prefix-number', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.160/node-type-token-admission/expression-zero', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.160/node-type-token-admission/comma-zero', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.160/node-type-token-admission/equals-zero', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.160/node-type-token-admission/slash-zero', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.160/node-type-token-admission/theme-zero', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.160/node-type-token-admission/unknown-zero', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.160/node-type-token-admission/unicode-identifier', 'SUCCESSFUL_LINE_TRIM_INVALID'],
  ['M4.160/node-type-token-admission/unicode-drop-coordinates', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.160/node-type-token-admission/number-zero', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.160/node-type-token-admission/quoted-zero', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.160/node-type-token-admission/style-zero', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.161/builtin-node-type-attestation/dropped-symbol', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.161/builtin-node-type-attestation/quoted-drop-astral', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.162/mutable-node-type-registry-snapshot/dropped', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.163/known-node-warning/dropped', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.164/generic-property-admission/dropped-node', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.165/generic-property-loop/dropped-node', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.166/generic-property-theme-refs/property-limit-before-style', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.166/generic-property-theme-refs/theme-limit-before-style', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.166/generic-property-theme-refs/dropped-node', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.167/generic-property-style-theme/property-limit-before-style', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.167/generic-property-style-theme/theme-limit-before-style', 'SUCCESSFUL_LINE_CHILD_INVALID'],
  ['M4.167/generic-property-style-theme/dropped-node', 'SUCCESSFUL_LINE_CHILD_INVALID'],
]);

const GROUPS = Object.freeze([
  ['M4.153', [['tokenizer', TOKENIZER_FIXTURES]]],
  ['M4.154', [['stitcher', STITCHER_FIXTURES]]],
  ['M4.155', [['indentation', INDENTATION_FIXTURES]]],
  ['M4.156', [['lexical', LEXICAL_FIXTURES]]],
  ['M4.157', [['comment-boundary', COMMENT_BOUNDARY_FIXTURES]]],
  ['M4.158', [['whitespace-trim', WHITESPACE_TRIM_FIXTURES]]],
  ['M4.159', [['retained-token-stream', RETAINED_TOKEN_STREAM_FIXTURES]]],
  ['M4.160', [['node-type-token-admission', NODE_TYPE_TOKEN_ADMISSION_FIXTURES]]],
  ['M4.161', [['builtin-node-type-attestation', BUILTIN_ATTESTATION_FIXTURES]]],
  ['M4.162', [['mutable-node-type-registry-snapshot', MUTABLE_REGISTRY_SNAPSHOT_FIXTURES]]],
  ['M4.163', [[
    'known-node-warning',
    knownNodeWarningTruthTableFixtures(loadFrontendKnownNodeWarningPolicy()),
  ]]],
  ['M4.164', [['generic-property-admission', GENERIC_PROPERTY_ADMISSION_FIXTURES]]],
  ['M4.165', [['generic-property-loop', GENERIC_PROPERTY_LOOP_FIXTURES]]],
  ['M4.166', [['generic-property-theme-refs', GENERIC_PROPERTY_THEME_REFS_FIXTURES]]],
  ['M4.167', [['generic-property-style-theme', GENERIC_PROPERTY_STYLE_THEME_FIXTURES]]],
  ['M4.168', [[
    'generic-property-style-theme-diagnostics',
    GENERIC_PROPERTY_STYLE_THEME_DIAGNOSTIC_FIXTURES,
  ]]],
  ['M4.169', [['evolved-hints', EVOLVED_HINT_FIXTURES]]],
  ['M4.170', [
    ['keyword-handlers', KEYWORD_HANDLER_FIXTURES],
    ['keyword-handler-fallbacks', KEYWORD_HANDLER_FALLBACK_FIXTURES],
    ['keyword-handler-edges', KEYWORD_HANDLER_EDGE_FIXTURES],
    ['keyword-handler-numerics', KEYWORD_HANDLER_NUMERIC_FIXTURES],
  ]],
]);

function sourceProfileExclusion(source) {
  if (typeof source !== 'string' || source.length === 0) return 'empty';
  if (/[\n\r\u2028\u2029]/u.test(source)) return 'multiline';
  let indent = 0;
  while (source[indent] === ' ') indent += 1;
  if (indent >= source.length) return 'blank';
  if (UNSUPPORTED_LEADING_WHITESPACE.test(source[indent])) return 'unsupported-indentation';
  return null;
}

function names(value, type) {
  if (Array.isArray(value)) return [...value].sort();
  return value === true && typeof type === 'string' && type.length > 0 ? [type] : [];
}

function runtimeConfig(fixture) {
  const evolved = names(fixture.evolved, fixture.type);
  if (fixture.hints !== undefined && fixture.type !== 'class' && !evolved.includes(fixture.type)) {
    evolved.push(fixture.type);
    evolved.sort();
  }
  return {
    evolved,
    hints: fixture.hints === undefined ? null : { hints: fixture.hints, type: fixture.type },
    multiline: names(fixture.multiline, fixture.type),
    templates: names(fixture.templates ?? fixture.template, fixture.type),
  };
}

export function successfulLineReplayManifest() {
  const byKey = new Map();
  const boundaryExcluded = [];
  const sourceExcluded = [];
  const totals = {};
  for (const [stage, groups] of GROUPS) {
    totals[stage] = { boundaryExcluded: 0, sourceExcluded: 0, total: 0 };
    for (const [group, fixtures] of groups) {
      for (const fixture of fixtures) {
        totals[stage].total += 1;
        const ref = `${stage}/${group}/${fixture.id}`;
        const boundaryReason = BOUNDARY_EXCLUSIONS.get(ref);
        if (boundaryReason !== undefined) {
          totals[stage].boundaryExcluded += 1;
          boundaryExcluded.push({ reason: boundaryReason, ref });
          continue;
        }
        const exclusion = sourceProfileExclusion(fixture.source);
        if (exclusion !== null) {
          totals[stage].sourceExcluded += 1;
          sourceExcluded.push({ reason: exclusion, ref });
          continue;
        }
        const config = runtimeConfig(fixture);
        const expectedCode = EXPECTED_PREDECESSOR_EXCLUSIONS.get(ref) ?? null;
        const key = `${fixture.source}\u0000${JSON.stringify(config)}\u0000${expectedCode ?? 'decision'}`;
        const existing = byKey.get(key);
        if (existing) existing.refs.push(ref);
        else byKey.set(key, { config, expectedCode, raw: fixture.source, refs: [ref] });
      }
    }
  }
  return {
    boundaryExcluded,
    cases: [...byKey.values()],
    expectedPredecessorExcluded: [...EXPECTED_PREDECESSOR_EXCLUSIONS].map(([ref, code]) => ({ code, ref })),
    sourceExcluded,
    totals,
  };
}

function configuredWorkerCount(caseCount, requested = process.env.KERN_FRONTEND_REPLAY_WORKERS) {
  const parsed = requested === undefined ? NaN : Number(requested);
  const configured = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : availableParallelism();
  return Math.max(1, Math.min(caseCount, configured));
}

function runWorker(cases) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./replay-worker.mjs', import.meta.url), { workerData: cases });
    let receipt;
    worker.once('error', reject);
    worker.once('message', (message) => {
      receipt = message;
    });
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`successful-line replay worker exited ${code}`));
      } else if (receipt === undefined) {
        reject(new Error('successful-line replay worker exited without a receipt'));
      } else {
        resolve(receipt);
      }
    });
  });
}

export async function runSuccessfulLineReplay() {
  const manifest = successfulLineReplayManifest();
  const workerCount = configuredWorkerCount(manifest.cases.length);
  const partitions = Array.from({ length: workerCount }, () => []);
  manifest.cases.forEach((entry, index) => partitions[index % workerCount].push(entry));
  const walls = await Promise.all(partitions.map(runWorker));
  const failures = walls.flatMap((wall) => wall.failures);
  if (failures.length > 0) {
    throw new Error(`successful-line replay failures: ${JSON.stringify(failures)}`);
  }
  const admittedRefs = walls.reduce((sum, wall) => sum + wall.admittedRefs, 0);
  const predecessorExcluded = walls.flatMap((wall) => wall.predecessorExcluded);
  return {
    admittedRefs,
    boundaryExcluded: manifest.boundaryExcluded,
    excludedRefs: manifest.boundaryExcluded.length + manifest.sourceExcluded.length + predecessorExcluded.length,
    predecessorExcluded,
    sourceExcluded: manifest.sourceExcluded,
    stages: manifest.totals,
    totalRefs: Object.values(manifest.totals).reduce((sum, stage) => sum + stage.total, 0),
    uniqueCases: manifest.cases.length,
    workers: workerCount,
  };
}
