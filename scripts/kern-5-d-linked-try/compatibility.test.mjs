import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { TARGET_KERNEL_SHA256 as JAVASCRIPT_KERNEL } from '../../packages/core/dist/compiler/kir-js-esm/emitter.js';
import { TARGET_KERNEL_SHA256 as PYTHON_KERNEL } from '../../packages/core/dist/compiler/kir-python/emitter.js';
import { E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION } from '../kern-canonicalizer/e0-loop-extraction-historical-transition.mjs';
import {
  ALPHA_RECEIPT_BINDING_COUNT,
  BASE_EXPRESSION_KIND_COUNT,
  BASE_LINE_COUNTS,
  CASCADE_BASE_DIGESTS,
  COMPILED_CORE_COUNT,
  CONTRACT_WALL_SCRIPTS,
  F5_POLICY_SHA256,
  FILE_LINE_CEILING,
  FROZEN_KERNEL_DIGESTS,
  FROZEN_NEIGHBOUR_DIGESTS,
  FROZEN_PYTHON_DIRECTORY_FILES,
  LINE_BUDGETS,
  RC_V1_AMENDMENT_COUNT,
  RT1_EVALUATOR_HEADROOM,
  SPEC_PATH,
  THIRTEEN_DIAGNOSTIC_CODES,
} from './pins.mjs';
import { repositoryText } from './k0-support.mjs';

const ROOT = new URL('../../', import.meta.url);

function digestOf(relativePath) {
  return createHash('sha256').update(readFileSync(new URL(relativePath, ROOT))).digest('hex');
}

function lineCount(relativePath) {
  return repositoryText(relativePath).split('\n').length - 1;
}

// GREEN at base and must stay GREEN. Both kernels are byte-frozen because `__UserThrow` and
// `__throwLabel` are emitted per module from `specializedSource`, never added to one of the four
// TARGET_* sources the digest is taken over.
test('both target kernels keep the digests D.0 pinned, because D adds no kernel byte', () => {
  assert.equal(JAVASCRIPT_KERNEL, FROZEN_KERNEL_DIGESTS.javascript, 'D_KERNEL_TOUCH: the JavaScript kernel moved');
  assert.equal(PYTHON_KERNEL, FROZEN_KERNEL_DIGESTS.python, 'D_KERNEL_TOUCH: the Python kernel moved');
});

test('the F5 projection policy digest does not move, because all four nodes already project', () => {
  assert.equal(
    digestOf('scripts/kern-frontend-f5-projection/policy.json'),
    F5_POLICY_SHA256,
    'D_FRONTEND_TOUCH: the F5 policy moved, so D changed a projection decision it must not touch',
  );
});

test('the three neighbour goldens D scrapes nothing from do not move', () => {
  for (const [path, expected] of Object.entries(FROZEN_NEIGHBOUR_DIGESTS)) {
    assert.equal(digestOf(path), expected, `D_GOLDEN_DRIFT: ${path} moved and D scrapes no surface it carries`);
  }
});

// The other half of the digest story, and the one that goes RED once the cascade runs: rt2, rt3, rt9,
// rt4's probe matrix and the parity ledger all scrape a surface D moves, so each of these MUST
// change. Pinned at base so a cascade that forgot one is a named failure rather than a silent pass.
test('the five cascade digests are still at their base value, and every one of them must move', () => {
  const unmoved = Object.entries(CASCADE_BASE_DIGESTS).filter(([path, expected]) => digestOf(path) === expected);
  assert.deepEqual(
    unmoved.map(([path]) => path),
    [],
    'D_CASCADE_PENDING: these files scrape a surface D moves and are still at their pre-D digest',
  );
});

test('the Python compiler directory stays at exactly seven files, so the emitter is untouched', () => {
  const names = readdirSync(new URL('packages/core/src/compiler/kir-python/', ROOT)).filter((name) =>
    name.endsWith('.ts'),
  );
  assert.equal(
    names.length,
    FROZEN_PYTHON_DIRECTORY_FILES,
    'D_PYTHON_TOUCH: the byte-frozen Python compiler directory changed shape',
  );
});

// Slice E.0's extraction opened the next head stage, so the live inventory is no longer D's
// successor. What D still owns is that D itself added no source file: strip E.0's three paths and
// the count must come back to the attested 357.
test('the compiled core inventory stays at the attested 357 paths, because D adds no source file', () => {
  const paths = [];
  (function visit(url, prefix) {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(new URL(`${entry.name}/`, url), `${prefix}${entry.name}/`);
      else if (entry.isFile() && entry.name.endsWith('.js')) paths.push(`${prefix}${entry.name}`);
    }
  })(new URL('packages/core/dist/', ROOT), '');
  const afterE0 = paths.filter((path) => !E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION.addedPaths.includes(path));
  assert.equal(
    afterE0.length,
    COMPILED_CORE_COUNT,
    'D_INVENTORY_TRANSITION: D must open no head-stage transition; the QD-2 escape hatch was not taken',
  );
});

test('the diagnostic code union stays at thirteen members and the envelope shape does not widen', () => {
  const contracts = repositoryText('packages/core/src/kir-runtime/contracts.ts');
  const codes = contracts.slice(
    contracts.indexOf('export type KernKirDiagnosticCode ='),
    contracts.indexOf('export interface KernKirDiagnostic '),
  );
  assert.ok(codes.length > 0, 'the diagnostic code union must be locatable');
  assert.equal(
    codes.split("  | '").length - 1,
    THIRTEEN_DIAGNOSTIC_CODES,
    'D_CODE_CREEP: the KIR diagnostic union must stay at the thirteen D.0 landed',
  );
  const diagnostic = contracts.slice(
    contracts.indexOf('export interface KernKirDiagnostic '),
    contracts.indexOf('export interface KernKirEnvelope'),
  );
  assert.deepEqual(
    [...diagnostic.matchAll(/readonly ([a-zA-Z]+):/gu)].map((match) => match[1]).sort(),
    ['category', 'code', 'phase'],
    'D_ENVELOPE_WIDENED: KernKirDiagnostic has no label channel and must not gain one',
  );
  assert.equal(diagnostic.includes('label'), false, 'D_ENVELOPE_WIDENED: the clamped label rides the fault message');
});

test('the linked expression union gains no member, because the payload rides the record kind', () => {
  const contracts = repositoryText('packages/core/src/kir-runtime/linked-kir-program/contracts.ts');
  const union = contracts.slice(
    contracts.indexOf('export type LinkedKernKirExpression ='),
    contracts.indexOf('export type LinkedKernKirParameterType'),
  );
  assert.ok(union.length > 0, 'the expression union must be locatable');
  assert.equal(
    [...union.matchAll(/readonly kind: '([a-z-]+)'/gu)].length,
    BASE_EXPRESSION_KIND_COUNT,
    'D_EXPRESSION_CREEP: D adds zero expression-union members',
  );
});

test('every source file D edits stays under its own line budget and the 500-line ceiling', () => {
  const over = [];
  for (const [path, budget] of Object.entries(LINE_BUDGETS)) {
    const measured = lineCount(path);
    if (measured > budget) over.push(`${path} at ${measured} over budget ${budget}`);
    if (measured >= FILE_LINE_CEILING) over.push(`${path} at ${measured} reaches the ${FILE_LINE_CEILING} ceiling`);
  }
  assert.deepEqual(over, [], 'D_LINE_BUDGET: a file D edits exceeded its budget or the doctrine ceiling');
});

// QD-2's headroom row, separate from the ceiling so the two failures are distinguishable: a file
// that lands between 470 and 500 has spent its slack and owes the pre-registered `try-walk.ts` cut.
// Slice E.0 took the QD-2 cut, under a different name: the walk moved to statement-walker.ts byte
// for byte. The headroom is therefore measured across the pair, and the growth row follows the arms
// into the file that now holds them.
test('the RT-1 evaluator finishes under its 470-line headroom, not merely under the ceiling', () => {
  const evaluator = lineCount('packages/core/src/kir-runtime/expression.ts');
  const walker = lineCount('packages/core/src/kir-runtime/statement-walker.ts');
  for (const [path, measured] of [
    ['packages/core/src/kir-runtime/expression.ts', evaluator],
    ['packages/core/src/kir-runtime/statement-walker.ts', walker],
  ]) {
    assert.ok(
      measured <= RT1_EVALUATOR_HEADROOM,
      `D_HEADROOM_SPENT: ${path} is ${measured} lines against the ${RT1_EVALUATOR_HEADROOM} headroom; the QD-2 escape hatch is owed`,
    );
  }
  assert.ok(
    evaluator + walker > BASE_LINE_COUNTS['packages/core/src/kir-runtime/expression.ts'],
    'D_ARMS_MISSING: the RT-1 walk has not grown, so the throw and try arms are absent',
  );
  const arms = repositoryText('packages/core/src/kir-runtime/statement-walker.ts');
  for (const marker of ["statement.kind === 'throw'", "statement.kind === 'try'"]) {
    assert.ok(arms.includes(marker), `D_ARMS_MISSING: the walk must still carry ${marker}`);
  }
});

test('every oracle file in this suite stays under the 500-line ceiling', () => {
  const directory = new URL('./', import.meta.url);
  for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.mjs'))) {
    const measured = readFileSync(new URL(name, directory), 'utf8').split('\n').length - 1;
    assert.ok(measured < FILE_LINE_CEILING, `D_LINE_BUDGET: scripts/kern-5-d-linked-try/${name} is ${measured} lines`);
  }
});

test('this slice spec exists on disk at the path every ledger row cites', () => {
  assert.ok(existsSync(new URL(SPEC_PATH, ROOT)), `D_SPEC_MISSING: ${SPEC_PATH} must exist`);
});

test('the RC-v1 governed surface is untouched: three amendments and 125 receipt bindings', () => {
  const amendments = readdirSync(new URL('scripts/runtime-contract-v1/amendments/', ROOT)).filter((name) =>
    name.endsWith('.json'),
  );
  assert.equal(amendments.length, RC_V1_AMENDMENT_COUNT, 'D_RC_V1_AMENDED: D creates no amendment record');
  const policy = JSON.parse(readFileSync(new URL('scripts/kir-v1/alpha-receipt-policy.json', ROOT), 'utf8'));
  assert.equal(
    policy.bindings.length,
    ALPHA_RECEIPT_BINDING_COUNT,
    'D_RECEIPT_BOUND: D binds no new receipt path',
  );
});

// D-3g2. Three executable gates in place of a chain of reasoning, so a closed-set surprise on the
// public diagnostic surface fails at oracle time instead of CI time. GREEN at base.
for (const script of CONTRACT_WALL_SCRIPTS) {
  test(`the contract wall ${script} passes, so the public diagnostic surface holds no surprise`, () => {
    assert.ok(existsSync(new URL(`scripts/${script}`, ROOT)), `D_WALL_MISSING: scripts/${script} must exist`);
    execFileSync(process.execPath, [`scripts/${script}`], { cwd: new URL('.', ROOT), stdio: 'pipe' });
  });
}

// rt12 measured `STILL_OUTSIDE` as already `['each','set']` in all three neighbour suites: the try
// family was never in them, so nothing shrinks and no edit is licensed. This row pins that, so a
// later slice cannot claim D narrowed a list it never touched.
test('the STILL_OUTSIDE lists are untouched, because the try family was never in them', () => {
  for (const suite of ['kern-5-rt10-for', 'kern-5-rt11-linked-while', 'kern-5-rt12-linked-jumps']) {
    const source = repositoryText(`scripts/${suite}/compatibility.test.mjs`);
    const list = source.slice(source.indexOf('STILL_OUTSIDE'), source.indexOf('STILL_OUTSIDE') + 120);
    assert.match(
      list,
      /\['each', 'set'\]/u,
      `D_SCOPE_CREEP: ${suite} STILL_OUTSIDE must stay exactly ['each','set']`,
    );
  }
});

test('no tracked kern file reaches the link stage, so admitting the try family moves no census row', () => {
  const census = JSON.parse(readFileSync(new URL('scripts/kern-5-admission-census/admission.json', ROOT), 'utf8'));
  assert.equal(census.total, 240, 'D_CENSUS_SHAPE: the tracked corpus size moved');
  assert.deepEqual(
    census.results.filter((row) => row.stage === 'link').map((row) => row.file),
    [],
    'D_CENSUS_REACHABLE: a file now reaches the linker, so widening the linker can change admission',
  );
  assert.equal(census.admittedCount, 1, 'D_CENSUS_GAIN: the admission gain must stay exactly zero');
});
