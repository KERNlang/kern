#!/usr/bin/env node
/**
 * Phase-2 Gate-INT — legacy-vs-AST convergence ratchet.
 *
 * Compares the legacy string emission path (`rewriteExpr`) against the AST/parser
 * path (`parseExpression` -> `emitPyExpressionWithImports`) for every EXPRESSION
 * corpus case, EXECUTES both (plus the TS reference) under python3/node, and
 * derives a per-case verdict from typed runtime canons (NaN/-0/undefined/call-log
 * preserved). It emits the reviewable five-column TSV + a JSON mirror with
 * summary counts, then enforces the monotonic ratchet vs the saved baseline.
 *
 *   node scripts/phase2-gate-int.mjs --canonicalizer-self-test
 *   node scripts/phase2-gate-int.mjs --check
 *   node scripts/phase2-gate-int.mjs --filter logical --check
 *   node scripts/phase2-gate-int.mjs --candidate-route logical --check
 *   node scripts/phase2-gate-int.mjs --update-baseline --reason "..."
 *   node scripts/phase2-gate-int.mjs --json --check
 *
 * Slice 0: NO route flips. The captured baseline is tagged
 * VOLATILE_PRE_STDREGISTRY_<sha> and the gate refuses any route flip while the
 * tag is volatile (printed LOUDLY). The first `--check` captures the baseline;
 * a second `--check` must be clean.
 *
 * Failure taxonomy: EXT/INT codes per `phase2-golden-baseline-spec.md`. Hard
 * fail-vacuous guards: empty filtered selection (INT_EMPTY_SELECTION), missing
 * baseline id, stale build, normalizer tamper, lossy canonicalizer self-test.
 *
 * Style mirrors `scripts/conformance.mjs` (plain ESM .mjs, top-of-file intent).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertBuildFresh, routeTableSha256, sourceTreeSha256 } from './phase2/lib/build-state.mjs';
import { captureAst, captureLegacy, captureTs, verifyLegacyFidelity } from './phase2/lib/capture.mjs';
import { executePython, executeTs } from './phase2/lib/execute-artifact.mjs';
import { decodeExpected, serializeEnvelope } from './phase2/lib/canonicalize.mjs';
import { PHASE2_CORPUS, assertUniqueIds, selectCases } from './phase2/lib/corpus.mjs';
import { DISCRIMINATOR_VERSION, denominatorReport } from './phase2/lib/discriminator.mjs';
import { computeAllCoverage } from './phase2/lib/route-coverage.mjs';
import { sha256, stableHash } from './phase2/lib/hash.mjs';
import {
  checkRegression,
  deriveVerdict,
  renderTsv,
  routeColumn,
  summarize,
} from './phase2/lib/ratchet.mjs';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const INT_DIR = join(REPO, 'packages/python/tests/__snapshots__/phase2/int');
const TSV_PATH = join(INT_DIR, 'ratchet.tsv');
const JSON_PATH = join(INT_DIR, 'ratchet.json');
const DENOM_PATH = join(INT_DIR, 'denominator.json');
const COVERAGE_PATH = join(INT_DIR, 'coverage.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => {
  const i = args.indexOf(f);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
};

function fail(code, detail) {
  console.error(`\nGate-INT FAILED: ${code}\n  ${detail}\n`);
  process.exit(1);
}

function gitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return 'nogit';
  }
}

function volatileTag() {
  return `VOLATILE_PRE_STDREGISTRY_${gitShortSha()}`;
}

// ── canonicalizer self-test: re-run the committed cross-language oracle ───────
if (has('--canonicalizer-self-test')) {
  console.log('Gate-INT: canonicalizer self-test (cross-language atan2 oracle)\n');
  const res = spawnSync(
    'node',
    [join(REPO, 'scripts/run-node-tests.mjs'), 'tests/phase2/canonicalize.test.ts'],
    { cwd: join(REPO, 'packages/python'), encoding: 'utf8', stdio: 'inherit' },
  );
  if (res.status !== 0) fail('SEMANTIC_CANON_LOSS', 'canonicalizer self-test did not pass');
  console.log('\nGate-INT: canonicalizer self-test GREEN.');
  process.exit(0);
}

// ── build freshness ──────────────────────────────────────────────────────────
try {
  assertBuildFresh(REPO);
} catch (err) {
  fail('INT_CAPTURE_ERROR', String(err.message ?? err));
}

assertUniqueIds();

// ── call-convention consistency oracle (hard precondition) ───────────────────
// Prove the legacy capture uses production's documented `rewriteExpr` call
// convention (conformance.mjs:1903) AND that the framing derivation is
// independently consistent (a separate re-derivation agrees on the tuple + the
// bytes). This is NOT a cross-shipment byte diff — a full production-route-replay
// cross-check is deferred to the route-corpus slice (see capture.mjs header). A
// failure here means a framing bug or a broken call convention, so no verdict is
// trustworthy.
const fidelity = await verifyLegacyFidelity(PHASE2_CORPUS, REPO);
if (!fidelity.ok) {
  const bad = fidelity.rows.filter((r) => !r.match).map((r) => `${r.id}: ${r.note}`);
  fail('INT_CAPTURE_ERROR', `legacy call-convention consistency oracle FAILED:\n  ${bad.join('\n  ')}`);
}

// ── selection ─────────────────────────────────────────────────────────────────
const filterRoute = valOf('--filter') ?? valOf('--candidate-route');
const selected = selectCases({ route: filterRoute ?? undefined, denominator: 'EXPRESSION' }).filter(
  (c) => c.deterministic,
);
if (selected.length === 0) {
  fail('INT_EMPTY_SELECTION', `no EXPRESSION cases for filter=${filterRoute ?? '(all)'}`);
}

// ── capture + execute + derive verdicts ───────────────────────────────────────
const records = [];
const tsvRows = [];
for (const c of selected) {
  const route = filterRoute ?? c.routes[0];
  const legacyCapture = await captureLegacy(c, REPO);
  const astCapture = await captureAst(c, REPO);
  const tsCapture = await captureTs(c, REPO);

  const legacyRun =
    legacyCapture.status === 'ok'
      ? executePython(legacyCapture, c.bindings)
      : { status: 'error', code: legacyCapture.code, category: legacyCapture.category };
  const astRun =
    astCapture.status === 'ok'
      ? executePython(astCapture, c.bindings)
      : { status: 'error', code: astCapture.code, category: astCapture.category };
  const tsRun =
    tsCapture.status === 'ok'
      ? executeTs(tsCapture.jsExpr, c.bindings)
      : { status: 'error', code: tsCapture.code, category: tsCapture.category };

  let expectedCanon = null;
  if (c.expected !== undefined) {
    try {
      const { cv, calls } = decodeExpected(c.expected);
      expectedCanon = serializeEnvelope(cv, calls);
    } catch {
      // A non-executable expected (e.g. parse-shape assertion) has no envelope;
      // leave it null so the row is judged by capture/runtime state only.
      expectedCanon = null;
    }
  }

  const { verdict, triage } = deriveVerdict({
    caseId: c.id,
    route,
    legacyCapture,
    astCapture,
    legacyRun,
    astRun,
    tsRun,
    expectedCanon,
  });

  const pyLegacyColumn = routeColumn(legacyCapture, sha256);
  const pyAstColumn = routeColumn(astCapture, sha256);

  tsvRows.push({ caseId: c.id, route, pyLegacyColumn, pyAstColumn, verdict });
  records.push({
    caseId: c.id,
    route,
    tags: c.tags,
    sourceSha256: sha256(c.source),
    pyLegacy: {
      status: legacyCapture.status,
      artifactSha256: legacyCapture.status === 'ok' ? sha256(legacyCapture.code) : null,
      runtimeCanon: legacyRun.status === 'ok' ? legacyRun.runtimeCanon : null,
      error: legacyRun.status === 'error' ? { code: legacyRun.code, category: legacyRun.category } : null,
    },
    pyAst: {
      status: astCapture.status,
      artifactSha256: astCapture.status === 'ok' ? sha256(astCapture.code) : null,
      runtimeCanon: astRun.status === 'ok' ? astRun.runtimeCanon : null,
      error: astRun.status === 'error' ? { code: astRun.code, category: astRun.category } : null,
      fallbackUsed: false,
    },
    tsCanon: tsRun.status === 'ok' ? tsRun.runtimeCanon : null,
    expectedCanon,
    expectedFirstCapture: c.expectedFirstCapture ?? null,
    verdict,
    triage,
  });
}

const summary = summarize(records);
const current = {
  version: 1,
  baselineTag: volatileTag(),
  sourceTreeSha256: sourceTreeSha256(REPO),
  routeTableSha256: routeTableSha256(),
  routeTableSchemaSha256: stableHash({ schemaVersion: 0 }),
  corpusSha256: stableHash(PHASE2_CORPUS),
  discriminatorVersion: DISCRIMINATOR_VERSION,
  discriminatorSha256: sha256(readFileSync(join(REPO, 'scripts/phase2/lib/discriminator.mjs'))),
  selectedCaseIds: selected.map((c) => c.id),
  summary,
  records,
};

const tsv = renderTsv(tsvRows);
const denom = denominatorReport(PHASE2_CORPUS);
const coverage = computeAllCoverage();

// ── SEMANTIC_BOTH_WRONG is always CI-failing ─────────────────────────────────
const bothWrong = records.filter((r) => r.verdict === 'SEMANTIC_BOTH_WRONG');
if (bothWrong.length > 0) {
  fail('SEMANTIC_BOTH_WRONG', `both routes agree but disagree with reference:\n  ${bothWrong.map((r) => r.caseId).join('\n  ')}`);
}

// ── --update-baseline / first-capture write ──────────────────────────────────
const baselineExists = existsSync(JSON_PATH);

if (has('--update-baseline') || !baselineExists) {
  if (has('--update-baseline') && !valOf('--reason')) {
    fail('INT_RATCHET_REGRESSION', '--update-baseline requires --reason');
  }
  mkdirSync(INT_DIR, { recursive: true });
  writeFileSync(TSV_PATH, tsv);
  writeFileSync(JSON_PATH, `${JSON.stringify(current, null, 2)}\n`);
  writeFileSync(DENOM_PATH, `${JSON.stringify(denom, null, 2)}\n`);
  writeFileSync(COVERAGE_PATH, `${JSON.stringify(coverage, null, 2)}\n`);
  printVolatileBanner();
  console.log(
    `\nGate-INT: ${baselineExists ? 'baseline UPDATED' : 'initial baseline CAPTURED'} ` +
      `(${records.length} cases, ratchetCount=${summary.ratchetCount}).`,
  );
  printVerdictTable(records);
  if (!baselineExists && !has('--update-baseline')) {
    console.log('\n(First capture of a VOLATILE baseline — run --check again to verify it is clean.)');
  }
  process.exit(0);
}

// ── --check: compare against saved baseline ───────────────────────────────────
const baseline = JSON.parse(readFileSync(JSON_PATH, 'utf8'));

// Missing-baseline-id guard: every selected case must have a saved record.
const savedIds = new Set(baseline.records.map((r) => r.caseId));
for (const c of selected) {
  if (!savedIds.has(c.id)) {
    fail('INT_CAPTURE_ERROR', `selected case ${c.id} has no saved baseline record (run --update-baseline)`);
  }
}

// Monotonic regression check (per-case + aggregate). When filtered, scope the
// baseline to the SELECTED case ids and recompute its summary from that subset —
// otherwise a logical-only run would compare its (legitimately 0) ratchetCount
// against the whole-corpus summary and false-fail.
const selectedIdSet = new Set(selected.map((c) => c.id));
const baselineSubset = baseline.records.filter((r) => selectedIdSet.has(r.caseId));
const baselineSummary = filterRoute ? summarize(baselineSubset) : baseline.summary;
const violations = checkRegression(
  { records, summary },
  { records: baselineSubset, summary: baselineSummary },
);
if (violations.length > 0) {
  fail(violations[0].split(':')[0], violations.join('\n  '));
}

// Volatile-tag route-flip refusal: any --candidate-route flip is refused while volatile.
if (has('--candidate-route') && String(baseline.baselineTag).startsWith('VOLATILE_')) {
  fail(
    'INT_FORBIDDEN_ROUTE_FLIP',
    `route flip for "${valOf('--candidate-route')}" refused: baseline tag is ${baseline.baselineTag} (volatile)`,
  );
}

printVolatileBanner();
console.log(`\nGate-INT: CHECK GREEN — ${records.length} cases, ratchetCount=${summary.ratchetCount}, no regression.`);
printVerdictTable(records);

if (has('--json')) {
  console.log(`\n${JSON.stringify({ summary, records: records.map((r) => ({ caseId: r.caseId, verdict: r.verdict })) }, null, 2)}`);
}
process.exit(0);

// ── helpers ────────────────────────────────────────────────────────────────────
function printVolatileBanner() {
  const tag = volatileTag();
  const bar = '='.repeat(72);
  console.log(`\n${bar}`);
  console.log(`  VOLATILE BASELINE: ${tag}`);
  console.log('  Route flips are REFUSED while this tag is volatile (pre stdlib-registry).');
  console.log(bar);
}

function printVerdictTable(recs) {
  console.log('\n  case_id                                   verdict');
  console.log('  ' + '-'.repeat(64));
  for (const r of recs) {
    console.log(`  ${r.caseId.padEnd(42)}${r.verdict}`);
  }
}
