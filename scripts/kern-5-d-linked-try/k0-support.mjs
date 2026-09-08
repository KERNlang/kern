import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { KERN_KIR_RUNTIME_FORMAT } from '../../packages/core/dist/kir-runtime/contracts.js';
import { DEFERRAL_LABEL } from '../kern-5-parity-ledger/ledger-support.mjs';
import {
  ENTRY,
  admission,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  project,
  provider,
  stepRequest,
} from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import { loopStepBudget } from '../kern-5-rt10-for/k0-support.mjs';
import { SPEC_PATH } from './pins.mjs';

// rt12's harness already re-exports the whole rt2/rt4/rt6/rt9/rt10-pre/rt10-for/rt11 chain plus the
// jump machinery, and both the loop forms and the jump fixtures are load-bearing here.
export * from '../kern-5-rt12-linked-jumps/k0-support.mjs';

export * from './fixtures.mjs';

const require = createRequire(import.meta.url);

const TABLE_URL = new URL('./behavior-table.json', import.meta.url);
const COMMIT_ROWS_URL = new URL('./commit-rows.json', import.meta.url);

export const BEHAVIOR_TABLE_RAW = readFileSync(TABLE_URL, 'utf8');
export const TRY_TABLE_ROWS = Object.freeze(
  JSON.parse(BEHAVIOR_TABLE_RAW).rows.map((row) => Object.freeze({ ...row })),
);

// Read lazily: a missing or malformed mapping must be one named failure in the row that consumes it,
// not a module-load crash that takes every other file in the suite down with it.
export function commitRowsRaw() {
  assert.ok(existsSync(COMMIT_ROWS_URL), 'D_COMMIT_ROWS_MISSING: commit-rows.json must exist');
  return readFileSync(COMMIT_ROWS_URL, 'utf8');
}

export function commitRows() {
  return JSON.parse(commitRowsRaw());
}

export const TRY_SPEC_PATH = SPEC_PATH;
export const TRY_SPEC_URL = new URL(`../../${SPEC_PATH}`, import.meta.url);

export const LEDGER_THROW_ROW = Object.freeze({
  blockedBy: Object.freeze([]),
  label: DEFERRAL_LABEL,
  nodeKind: 'throw',
  since: 'kern-5-d',
  spec: SPEC_PATH,
  surface: 'statement',
});

// `try` waits on `throw`, not on the jump family: a catch clause is meaningless before a throw
// lowers, and the only coupling to `break`/`continue` is a link-time refusal.
export const LEDGER_TRY_ROW = Object.freeze({
  blockedBy: Object.freeze(['throw']),
  label: DEFERRAL_LABEL,
  nodeKind: 'try',
  since: 'kern-5-d',
  spec: SPEC_PATH,
  surface: 'statement',
});

export const LEDGER_TRY_FAMILY_ROWS = Object.freeze([LEDGER_THROW_ROW, LEDGER_TRY_ROW]);

export function repositoryText(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

export function occurrencesOf(source, needle) {
  return source.split(needle).length - 1;
}

// Two legs, not three: both new kinds are deferred on the Python leg by ledger row, so any fixture
// carrying one refuses at Python compile and can never claim a three-leg envelope.
export async function tryTwoLegs(source, request) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'D_PROJECTION_LOST: F5 must project the fixture source');
  const javascript = compileJavaScript(verified);
  assert.equal(
    javascript.outcome,
    'success',
    `D_LINK_REFUSED: the JavaScript leg refused the fixture with ${javascript.code}`,
  );
  const directCalls = [];
  const direct = await executeKernKir(verified, request, provider(directCalls));
  const javascriptRun = await executeJavaScriptChild(javascript.artifact.bytes, request);
  return { direct: { calls: directCalls, envelope: direct }, javascript: javascriptRun };
}

export async function tryTwoLegBytes(source, request) {
  const legs = await tryTwoLegs(source, request);
  const direct = envelopeBytes(legs.direct.envelope);
  assert.deepEqual(
    Buffer.from(envelopeBytes(legs.javascript.envelope)),
    Buffer.from(direct),
    'D_LEG_DIVERGENCE: the emitted JavaScript envelope diverged from RT-1 byte for byte',
  );
  return { bytes: direct, legs };
}

export async function assertTryAdmitted(name, source) {
  const row = await admission(source);
  assert.equal(row.projection, 'projected', `D_PROJECTION_LOST: ${name} must project so admission is a link decision`);
  assert.equal(row.rt1, 'admitted', `D_LINK_REFUSED: ${name} must link on RT-1, and the linker refused it`);
  assert.equal(
    row.javascript,
    'admitted',
    `D_LINK_REFUSED: ${name} must link on the JavaScript leg, and the linker refused it`,
  );
  return row;
}

export async function tryArtifact(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'D_PROJECTION_LOST: the fixture must project');
  const javascript = compileJavaScript(verified);
  assert.equal(
    javascript.outcome,
    'success',
    `D_LINK_REFUSED: the emitted artifact is unavailable because the JavaScript leg refused with ${javascript.code}`,
  );
  return {
    manifest: javascript.manifest,
    path: javascript.artifact.path,
    text: Buffer.from(javascript.artifact.bytes).toString('utf8'),
  };
}

export async function tryPythonCompile(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'D_PROJECTION_LOST: the fixture must project so the deferral is a compile decision');
  return compilePython(verified);
}

export async function assertTryStepThreshold(name, source, args = {}) {
  const rt1 = await loopStepBudget(source, args, `d-threshold-${name}`);
  const verified = await project(source);
  assert.ok(verified !== undefined, `D_PROJECTION_LOST: ${name} must project`);
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `D_LINK_REFUSED: ${name} failed the JavaScript compile: ${javascript.code}`);
  const runs = async (maxSteps) => {
    const request = stepRequest(`d-threshold-${name}-${maxSteps}`, args, maxSteps);
    const run = await executeJavaScriptChild(javascript.artifact.bytes, request);
    return run.envelope.outcome === 'success';
  };
  assert.equal(
    await runs(rt1.execution),
    true,
    `D_LEG_CHARGE_DRIFT: ${name} must succeed on the JavaScript leg at RT-1's execution count ${rt1.execution}`,
  );
  assert.equal(
    await runs(rt1.execution - 1),
    false,
    `D_LEG_CHARGE_DRIFT: ${name} must fail one step under RT-1's execution count, so the legs share a threshold`,
  );
  return rt1;
}

// The built runtime module, loaded through require so a missing export is a named assertion rather
// than an ESM link-time crash that takes the whole file down with it.
export function runtimeEvaluator() {
  return require('../../packages/core/dist/kir-runtime/expression.js');
}

// Hand-built linked statements, so the walk and the two semantic walkers can be asked about a
// `throw`/`try` with no linker involvement. Every path unreachable through linking still needs a
// fail-closed row, and only a direct drive can reach one.
export function linkedThrowStatement(entries = [{ key: 'message', text: 'boom' }]) {
  return Object.freeze({
    kind: 'throw',
    value: Object.freeze({
      entries: Object.freeze(
        entries.map((entry) =>
          Object.freeze({
            key: entry.key,
            value: Object.freeze({
              kind: 'literal',
              value: Object.freeze(
                entry.text === undefined ? { tag: 'null' } : { tag: 'text', value: entry.text },
              ),
            }),
          }),
        ),
      ),
      kind: 'record',
    }),
  });
}

export function linkedTryStatement({ binding = 'e', body, catchBody, finallyBody } = {}) {
  const statement = {
    body: Object.freeze(body ?? [linkedThrowStatement()]),
    catchBody: Object.freeze(catchBody ?? []),
    kind: 'try',
  };
  if (binding !== undefined) statement.binding = binding;
  if (finallyBody !== undefined) statement.finallyBody = Object.freeze(finallyBody);
  return Object.freeze(statement);
}

// Emitting a HAND-BUILT linked program is the only way to drive a payload the linker refuses: the
// payload gate is what keeps a non-text `message` out, so a source-level fixture can never reach the
// emitted label helper. `emitJavaScriptEsm` is the same entrypoint `compileKernKirToJavaScriptEsm`
// uses, so the artifact under test is the real one.
export async function emitLinkedProgram(program) {
  const { TARGET_KERNEL_SHA256, emitJavaScriptEsm } = require('../../packages/core/dist/compiler/kir-js-esm/emitter.js');
  const contracts = require('../../packages/core/dist/compiler/kir-js-esm/contracts.js');
  assert.equal(typeof emitJavaScriptEsm, 'function', 'D_EMITTER_MISSING: emitJavaScriptEsm must be exported');
  return emitJavaScriptEsm(program, {
    artifactFormat: contracts.KERN_KIR_JS_ESM_ARTIFACT_FORMAT,
    canonicalization: 'kern.canonical-json.v1',
    compilerFormat: contracts.KERN_KIR_JS_ESM_COMPILER_FORMAT,
    compilerRequestSha256: '0'.repeat(64),
    entry: ENTRY,
    hashAlgorithm: 'sha256',
    hostProfile: contracts.KERN_KIR_JS_ESM_HOST_PROFILE,
    kernelSha256: TARGET_KERNEL_SHA256,
    linkedProgramSha256: program.sha256,
    projectionArtifactSha256: program.projectionArtifactSha256,
    runtimeFormat: KERN_KIR_RUNTIME_FORMAT,
  });
}

// The payload the linker refuses, spliced into an already-linked program.
export function withNonTextMessage(program) {
  const statements = program.program.statements.map((statement) => {
    if (statement.kind !== 'throw') return statement;
    const entries = statement.value.entries.map((entry) =>
      entry.key === 'message'
        ? Object.freeze({ key: 'message', value: Object.freeze({ kind: 'literal', value: Object.freeze({ tag: 'null' }) }) })
        : entry,
    );
    return Object.freeze({ ...statement, value: Object.freeze({ entries: Object.freeze(entries), kind: 'record' }) });
  });
  assert.ok(
    statements.some((statement) => statement.kind === 'throw'),
    'D_THROW_ABSENT: the fixture must carry a throw to splice',
  );
  return Object.freeze({ ...program, program: Object.freeze({ ...program.program, statements: Object.freeze(statements) }) });
}

export function specCriteria() {
  const spec = readFileSync(TRY_SPEC_URL, 'utf8');
  const start = spec.indexOf('## Acceptance Criteria');
  const end = spec.indexOf('## Out of Scope');
  assert.ok(start >= 0 && end > start, 'D_SPEC_SHAPE: the Acceptance Criteria section must be locatable');
  const section = spec.slice(start, end);
  return {
    criteria: [...section.matchAll(/^- \[[ x]\] (.*)$/gmu)].map((match) => match[1].trim()),
    groups: [...section.matchAll(/^\*\*(.+?)\*\*$/gmu)].map((match) => match[1].trim()),
  };
}
