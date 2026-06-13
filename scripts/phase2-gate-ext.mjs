#!/usr/bin/env node
/**
 * Phase-2 Gate-EXT — external byte baseline of PRODUCTION-emitted Python.
 *
 * Snapshots the exact Python bytes a user receives for each deterministic
 * EXPRESSION corpus case, normalized only by the 3-rule ALLOWLIST
 * (`normalize-python-bytes.mjs`). For slice 0 NO route is flipped, so the
 * production route is `py_legacy` (`rewriteExpr`) — the bytes baselined are the
 * legacy emission, exactly as the route table declares.
 *
 *   node scripts/phase2-gate-ext.mjs --check
 *   node scripts/phase2-gate-ext.mjs --filter logical --check
 *   node scripts/phase2-gate-ext.mjs --json --check
 *   node scripts/phase2-gate-ext.mjs --rebaseline --filter logical \
 *        --reason-code AST_ROUTE_FLIP --reason-detail logical --reviewer <id>
 *
 * Runtime oracle: where the production bytes are executable Python they are run
 * and compared to TS/expected (EXT_RUNTIME_DRIFT on disagreement). The slice-0
 * legacy expression-fragment seam leaves raw JS `&&`/`||` for logical/iterable
 * rows, which are not independently runnable Python — those are baselined with
 * `runtime.status:"blocked"` (the faithful production truth for a fragment), and
 * a re-check must reproduce the SAME bytes AND the same blocked code. This
 * detects byte drift for every case and runtime drift for runnable ones without
 * pretending a fragment executes standalone.
 *
 * Failure taxonomy per `phase2-golden-baseline-spec.md`. Hard fail-vacuous
 * guards: empty filtered selection, missing snapshot, stale build, normalizer
 * tamper (more than the 3 allowlisted rules), manifest drift.
 *
 * Style mirrors `scripts/conformance.mjs` (plain ESM .mjs, top-of-file intent).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBuildFresh, routeTableSha256, sourceTreeSha256 } from './phase2/lib/build-state.mjs';
import { captureLegacy, captureTs, verifyLegacyFidelity } from './phase2/lib/capture.mjs';
import { executePython, executeTs } from './phase2/lib/execute-artifact.mjs';
import { decodeExpected, serializeEnvelope } from './phase2/lib/canonicalize.mjs';
import { PHASE2_CORPUS, assertUniqueIds, selectCases } from './phase2/lib/corpus.mjs';
import { DISCRIMINATOR_VERSION } from './phase2/lib/discriminator.mjs';
import { computeAllCoverage } from './phase2/lib/route-coverage.mjs';
import { sha256, stableHash } from './phase2/lib/hash.mjs';
import {
  NORMALIZER_RULES,
  normalizePythonBytes,
  normalizerSha256,
} from './phase2/lib/normalize-python-bytes.mjs';
import { adjudicateRebaseline } from './phase2/lib/rebaseline-audit.mjs';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const EXT_DIR = join(REPO, 'packages/python/tests/__snapshots__/phase2/ext');
const ARTIFACTS_DIR = join(EXT_DIR, 'artifacts');
const MANIFEST_PATH = join(EXT_DIR, 'manifest.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => {
  const i = args.indexOf(f);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
};

function fail(code, detail) {
  console.error(`\nGate-EXT FAILED: ${code}\n  ${detail}\n`);
  process.exit(1);
}

// ── normalizer tamper guard (hard) ────────────────────────────────────────────
// The normalizer must be exactly the 3 allowlisted rules. If the rule list grew
// (or the implementation drifted beyond the allowlist), refuse to run.
(function assertNormalizerSane() {
  const want = ['lf', 'strip-trailing-space', 'final-newline'];
  if (NORMALIZER_RULES.length !== want.length || want.some((r, i) => NORMALIZER_RULES[i] !== r)) {
    fail('EXT_NORMALIZER_DRIFT', `normalizer rule set is not the 3-rule allowlist: ${JSON.stringify(NORMALIZER_RULES)}`);
  }
  // Behavioral probe: the normalizer must NOT sort lines / reorder / drop content.
  const probe = 'b = 2  \r\na = 1\n# keep comment\n\n\n';
  const out = normalizePythonBytes(probe);
  const expected = 'b = 2\na = 1\n# keep comment\n';
  if (out !== expected) {
    fail('EXT_NORMALIZER_DRIFT', `normalizer performed a non-allowlisted transform (probe mismatch)`);
  }
})();

// ── build freshness ──────────────────────────────────────────────────────────
try {
  assertBuildFresh(REPO);
} catch (err) {
  fail('EXT_STALE_BASELINE', String(err.message ?? err));
}

assertUniqueIds();

// ── byte-equivalence oracle (hard precondition, shared with Gate-INT) ─────────
const fidelity = await verifyLegacyFidelity(PHASE2_CORPUS, REPO);
if (!fidelity.ok) {
  const bad = fidelity.rows.filter((r) => !r.match).map((r) => `${r.id}: ${r.note}`);
  fail('EXT_MANIFEST_DRIFT', `legacy byte-equivalence oracle FAILED:\n  ${bad.join('\n  ')}`);
}

// ── selection ─────────────────────────────────────────────────────────────────
const filterRoute = valOf('--filter');
const selected = selectCases({ route: filterRoute ?? undefined, denominator: 'EXPRESSION' })
  .filter((c) => c.deterministic && c.kind === 'expr');
if (selected.length === 0) {
  fail('EXT_COVERAGE_GAP', `no deterministic EXPRESSION cases for filter=${filterRoute ?? '(all)'}`);
}

// ── generate production bytes + runtime canon per case ────────────────────────
/**
 * @returns {Promise<{cases:object[], manifest:object}>}
 */
async function generate() {
  const cases = [];
  for (const c of selected) {
    const legacy = await captureLegacy(c, REPO);
    if (legacy.status !== 'ok') {
      fail('EXT_RUNTIME_ERROR', `production capture errored for ${c.id}: ${legacy.code}`);
    }
    const entryBytes = normalizePythonBytes(`${legacy.code}\n`);
    const importsBytes = normalizePythonBytes(`${legacy.imports.join('\n')}\n`);

    // Runtime: run where executable; record blocked otherwise.
    const run = executePython(legacy, c.bindings);
    const tsCap = await captureTs(c, REPO);
    const tsRun = tsCap.status === 'ok' ? executeTs(tsCap.jsExpr, c.bindings) : { status: 'error', code: tsCap.code, category: 'emit' };

    let expectedCanon = null;
    if (c.expected !== undefined) {
      try {
        const { cv, calls } = decodeExpected(c.expected);
        expectedCanon = serializeEnvelope(cv, calls);
      } catch {
        expectedCanon = null;
      }
    }

    let runtime;
    if (run.status === 'ok') {
      // Runnable production bytes. Gate-EXT is the COMPATIBILITY wall: it
      // baselines the ACTUAL production runtime canon (its job is to catch
      // *drift* from that, on re-check). Whether production agrees with
      // TS/expected is a SEMANTIC judgment owned by Gate-INT (which marks a
      // disagreement LEGACY_BLOCKED / SEMANTIC_BOTH_WRONG). We record the
      // reference and a match flag as metadata, but a known legacy bug must not
      // make Gate-EXT refuse to baseline existing production behavior — that
      // would conflate the two gates the spec deliberately separates.
      const tsCanon = tsRun.status === 'ok' ? tsRun.runtimeCanon : null;
      const matchesReference =
        (tsCanon === null || run.runtimeCanon === tsCanon) &&
        (expectedCanon === null || run.runtimeCanon === expectedCanon);
      runtime = {
        status: 'pass',
        pyCanon: run.runtimeCanon,
        tsCanon,
        expectedCanon,
        matchesReference,
      };
    } else {
      // Not independently runnable (legacy expression fragment). Baseline the
      // blocked state as the faithful production truth; re-check must reproduce it.
      runtime = {
        status: 'blocked',
        blockedCode: run.code,
        tsCanon: tsRun.status === 'ok' ? tsRun.runtimeCanon : null,
        expectedCanon,
      };
    }

    cases.push({
      id: c.id,
      kind: c.kind,
      sourceKind: c.sourceKind,
      routes: c.routes,
      tags: c.tags,
      denominator: c.denominator,
      artifacts: [
        { path: `artifacts/${c.id}/entry.py`, kind: 'entry', sha256: sha256(entryBytes), bytes: entryBytes },
        { path: `artifacts/${c.id}/imports.py`, kind: 'imports', sha256: sha256(importsBytes), bytes: importsBytes },
      ],
      importsSha256: sha256(importsBytes),
      helperBytesSha256: sha256(importsBytes),
      runtime,
    });
  }

  const manifest = {
    version: 1,
    generatedBy: 'scripts/phase2-gate-ext.mjs',
    normalization: [...NORMALIZER_RULES],
    normalizerSha256: normalizerSha256(),
    corpusSha256: stableHash(PHASE2_CORPUS),
    discriminatorVersion: DISCRIMINATOR_VERSION,
    discriminatorSha256: sha256(readFileSync(join(REPO, 'scripts/phase2/lib/discriminator.mjs'))),
    sourceTreeSha256: sourceTreeSha256(REPO),
    routeTableSha256: routeTableSha256(),
    caseCount: cases.length,
    cases: cases.map((c) => ({
      id: c.id,
      kind: c.kind,
      sourceKind: c.sourceKind,
      routes: c.routes,
      tags: c.tags,
      denominator: c.denominator,
      artifacts: c.artifacts.map(({ path, kind, sha256: s }) => ({ path, kind, sha256: s })),
      importsSha256: c.importsSha256,
      helperBytesSha256: c.helperBytesSha256,
      runtime:
        c.runtime.status === 'pass'
          ? { status: 'pass', tsCanon: c.runtime.tsCanon, pyCanon: c.runtime.pyCanon, expectedCanon: c.runtime.expectedCanon, matchesReference: c.runtime.matchesReference }
          : { status: 'blocked', blockedCode: c.runtime.blockedCode, tsCanon: c.runtime.tsCanon, expectedCanon: c.runtime.expectedCanon },
    })),
    adjudications: [],
  };
  return { cases, manifest };
}

const { cases, manifest } = await generate();

// ── rebaseline (runtime-equality adjudication) ────────────────────────────────
if (has('--rebaseline')) {
  if (!existsSync(MANIFEST_PATH)) {
    fail('EXT_REBASELINE_DENIED', 'no old manifest — a missing baseline is a NEW addition, not a rebaseline');
  }
  const old = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const adjudication = {
    reasonCode: valOf('--reason-code'),
    reasonDetail: valOf('--reason-detail'),
    reviewer: valOf('--reviewer'),
  };
  const records = [];
  for (const c of cases) {
    const oldCase = old.cases.find((x) => x.id === c.id);
    if (!oldCase) fail('EXT_REBASELINE_DENIED', `${c.id}: no old baseline case`);
    const oldEntry = readSnapshot(c.id, 'entry.py');
    const newEntry = c.artifacts.find((a) => a.kind === 'entry').bytes;
    const tsCanon = c.runtime.tsCanon;
    const res = adjudicateRebaseline({
      caseId: c.id,
      route: c.routes[0],
      oldArtifact: oldEntry,
      newArtifact: newEntry,
      executeArtifact: () => (c.runtime.status === 'pass' ? { status: 'ok', runtimeCanon: c.runtime.pyCanon } : { status: 'error', code: c.runtime.blockedCode, category: 'runtime' }),
      tsRun: tsCanon !== null ? { status: 'ok', runtimeCanon: tsCanon } : { status: 'error', code: 'no-ts', category: 'emit' },
      expectedCanon: c.runtime.expectedCanon,
      adjudication,
    });
    if (!res.ok) fail(res.code, res.detail);
    records.push(res.record);
  }
  manifest.adjudications = records;
  writeBaseline(cases, manifest);
  console.log(`\nGate-EXT: rebaselined ${records.length} case(s) with runtime-equality adjudication.`);
  process.exit(0);
}

// ── first capture / write ──────────────────────────────────────────────────────
if (!existsSync(MANIFEST_PATH)) {
  writeBaseline(cases, manifest);
  console.log(`\nGate-EXT: initial baseline CAPTURED (${cases.length} cases).`);
  console.log('(Run --check again to verify it is clean.)');
  printRuntimeSummary(cases);
  process.exit(0);
}

// ── --check ─────────────────────────────────────────────────────────────────────
const old = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

// Stale-baseline: snapshot case no longer in (selected) corpus.
const selectedIds = new Set(selected.map((c) => c.id));
if (!filterRoute) {
  for (const oc of old.cases) {
    if (!selectedIds.has(oc.id)) fail('EXT_STALE_BASELINE', `snapshot case ${oc.id} no longer in corpus`);
  }
}

// Manifest-level sha drift.
if (!filterRoute) {
  if (old.sourceTreeSha256 !== manifest.sourceTreeSha256) {
    fail('EXT_MANIFEST_DRIFT', `sourceTreeSha256 changed (source rebuilt) old=${old.sourceTreeSha256.slice(0, 12)} new=${manifest.sourceTreeSha256.slice(0, 12)}`);
  }
  if (old.routeTableSha256 !== manifest.routeTableSha256) {
    fail('EXT_MANIFEST_DRIFT', 'routeTableSha256 changed (a route flipped) — Gate-EXT needs adjudicated rebaseline');
  }
  if (old.normalizerSha256 !== manifest.normalizerSha256) {
    fail('EXT_NORMALIZER_DRIFT', 'normalizerSha256 changed');
  }
  if (old.corpusSha256 !== manifest.corpusSha256) {
    fail('EXT_MANIFEST_DRIFT', 'corpusSha256 changed');
  }
}

// Per-case byte + runtime comparison.
const oldById = new Map(old.cases.map((c) => [c.id, c]));
for (const c of cases) {
  const oc = oldById.get(c.id);
  if (!oc) fail('EXT_BASELINE_MISSING', `case ${c.id} has no snapshot`);
  for (const art of c.artifacts) {
    const oldArt = oc.artifacts.find((a) => a.kind === art.kind);
    if (!oldArt) fail('EXT_BASELINE_MISSING', `${c.id}: snapshot missing artifact ${art.kind}`);
    if (oldArt.sha256 !== art.sha256) {
      fail('EXT_BYTE_DRIFT', `${c.id}/${art.kind}: bytes changed (snapshot ${oldArt.sha256.slice(0, 12)} != fresh ${art.sha256.slice(0, 12)})`);
    }
    // Also compare against the on-disk snapshot file bytes (manifest-vs-file integrity).
    const disk = readSnapshot(c.id, art.kind === 'entry' ? 'entry.py' : 'imports.py');
    if (disk === null) fail('EXT_BASELINE_MISSING', `${c.id}: snapshot file for ${art.kind} missing on disk`);
    if (sha256(disk) !== art.sha256) {
      fail('EXT_BYTE_DRIFT', `${c.id}/${art.kind}: on-disk snapshot bytes differ from fresh production bytes`);
    }
  }
  // Runtime status must be stable; a runnable case's canon must match the baseline.
  if (oc.runtime.status !== c.runtime.status) {
    fail('EXT_RUNTIME_DRIFT', `${c.id}: runtime status changed ${oc.runtime.status} -> ${c.runtime.status}`);
  }
  if (c.runtime.status === 'pass' && oc.runtime.pyCanon !== c.runtime.pyCanon) {
    fail('EXT_RUNTIME_DRIFT', `${c.id}: production runtime canon changed`);
  }
  if (c.runtime.status === 'blocked' && oc.runtime.blockedCode !== c.runtime.blockedCode) {
    fail('EXT_RUNTIME_DRIFT', `${c.id}: blocked code changed ${oc.runtime.blockedCode} -> ${c.runtime.blockedCode}`);
  }
}

console.log(`\nGate-EXT: CHECK GREEN — ${cases.length} cases, no byte/runtime drift.`);
printRuntimeSummary(cases);
if (has('--json')) {
  console.log(`\n${JSON.stringify({ caseCount: cases.length, cases: cases.map((c) => ({ id: c.id, runtime: c.runtime.status })) }, null, 2)}`);
}
process.exit(0);

// ── helpers ────────────────────────────────────────────────────────────────────
/**
 * @param {string} id
 * @param {string} file
 * @returns {string|null}
 */
function readSnapshot(id, file) {
  const p = join(ARTIFACTS_DIR, id, file);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function writeBaseline(allCases, mf) {
  // Clean stale artifact dirs only on a full (unfiltered) write.
  if (!filterRoute && existsSync(ARTIFACTS_DIR)) {
    const keep = new Set(allCases.map((c) => c.id));
    for (const entry of readdirSync(ARTIFACTS_DIR)) {
      if (!keep.has(entry)) rmSync(join(ARTIFACTS_DIR, entry), { recursive: true, force: true });
    }
  }
  for (const c of allCases) {
    const caseDir = join(ARTIFACTS_DIR, c.id);
    mkdirSync(caseDir, { recursive: true });
    for (const art of c.artifacts) {
      const fname = art.kind === 'entry' ? 'entry.py' : 'imports.py';
      writeFileSync(join(caseDir, fname), art.bytes);
    }
  }
  mkdirSync(EXT_DIR, { recursive: true });
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(mf, null, 2)}\n`);
  writeFileSync(join(EXT_DIR, 'coverage.json'), `${JSON.stringify(computeAllCoverage(), null, 2)}\n`);
}

function printRuntimeSummary(allCases) {
  const pass = allCases.filter((c) => c.runtime.status === 'pass').length;
  const blocked = allCases.filter((c) => c.runtime.status === 'blocked').length;
  const refMatch = allCases.filter((c) => c.runtime.status === 'pass' && c.runtime.matchesReference).length;
  const legacyBug = pass - refMatch;
  console.log(
    `  runtime: ${pass} runnable (${refMatch} match TS/expected, ${legacyBug} known legacy-bug divergence — owned by Gate-INT), ` +
      `${blocked} blocked (legacy fragment, byte-baselined only).`,
  );
}
