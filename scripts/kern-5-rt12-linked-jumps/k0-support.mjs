import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
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
import { DEFERRAL_LABEL } from '../kern-5-parity-ledger/ledger-support.mjs';
import { loopStepBudget } from '../kern-5-rt10-for/k0-support.mjs';

// The rt11 harness already re-exports the whole rt4/rt6/rt9/rt10-pre/rt10-for chain plus its own
// `while` machinery, and both loop forms are load-bearing here.
export * from '../kern-5-rt11-linked-while/k0-support.mjs';

export * from './fixtures.mjs';

const TABLE_URL = new URL('./behavior-table.json', import.meta.url);

export const BEHAVIOR_TABLE_RAW = readFileSync(TABLE_URL, 'utf8');
export const JUMP_TABLE_ROWS = Object.freeze(
  JSON.parse(BEHAVIOR_TABLE_RAW).rows.map((row) => Object.freeze({ ...row })),
);

export const JUMP_SPEC_PATH = '.Codex/specs/kern-5-rt12-linked-jumps/spec.md';
export const JUMP_SPEC_URL = new URL(`../../${JUMP_SPEC_PATH}`, import.meta.url);

export const LEDGER_BREAK_ROW = Object.freeze({
  blockedBy: Object.freeze(['while']),
  label: DEFERRAL_LABEL,
  nodeKind: 'break',
  since: 'kern-5-rt12-linked-jumps',
  spec: JUMP_SPEC_PATH,
  surface: 'statement',
});

export const LEDGER_CONTINUE_ROW = Object.freeze({
  blockedBy: Object.freeze(['while']),
  label: DEFERRAL_LABEL,
  nodeKind: 'continue',
  since: 'kern-5-rt12-linked-jumps',
  spec: JUMP_SPEC_PATH,
  surface: 'statement',
});

export const LEDGER_JUMP_ROWS = Object.freeze([LEDGER_BREAK_ROW, LEDGER_CONTINUE_ROW]);

// Two legs, not three: both jump kinds are deferred on the Python leg by ledger row, so any fixture
// carrying one refuses at Python compile and can never claim a three-leg envelope.
export async function jumpTwoLegs(source, request) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the fixture source');
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `RT12J_LINK_REFUSED: javascript compile failed: ${javascript.code}`);
  const directCalls = [];
  const direct = await executeKernKir(verified, request, provider(directCalls));
  const javascriptRun = await executeJavaScriptChild(javascript.artifact.bytes, request);
  return { direct: { calls: directCalls, envelope: direct }, javascript: javascriptRun };
}

export async function jumpTwoLegBytes(source, request) {
  const legs = await jumpTwoLegs(source, request);
  const direct = envelopeBytes(legs.direct.envelope);
  assert.deepEqual(
    Buffer.from(envelopeBytes(legs.javascript.envelope)),
    Buffer.from(direct),
    'RT12J_LEG_DIVERGENCE: emitted JavaScript diverged from RT-1',
  );
  return { bytes: direct, legs };
}

// RT-1 links and executes under one budget, so its smallest succeeding `maxSteps` is
// `link + execution`; the emitted artifact is compiled once and its meter counts execution only.
// The two legs charge every slot identically exactly when the artifact's own threshold equals RT-1's
// execution count — pinned from both sides, which is what makes it a threshold and not a bound.
export async function assertJumpStepThreshold(name, source, args = {}) {
  const rt1 = await loopStepBudget(source, args, `rt12j-threshold-${name}`);
  const verified = await project(source);
  assert.ok(verified !== undefined, `${name} must project`);
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `RT12J_LINK_REFUSED: javascript compile failed: ${javascript.code}`);
  const runs = async (maxSteps) => {
    const request = stepRequest(`rt12j-threshold-${name}-${maxSteps}`, args, maxSteps);
    const run = await executeJavaScriptChild(javascript.artifact.bytes, request);
    return run.envelope.outcome === 'success';
  };
  assert.equal(
    await runs(rt1.execution),
    true,
    `RT12J_LEG_CHARGE_DRIFT: ${name} must succeed on the JavaScript leg at RT-1's execution count ${rt1.execution}`,
  );
  assert.equal(
    await runs(rt1.execution - 1),
    false,
    `RT12J_LEG_CHARGE_DRIFT: ${name} must fail one step under RT-1's execution count, so the legs share a threshold`,
  );
  return rt1;
}

export async function jumpArtifact(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the fixture must project');
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `RT12J_LINK_REFUSED: javascript compile failed: ${javascript.code}`);
  return Buffer.from(javascript.artifact.bytes).toString('utf8');
}

export async function jumpPythonCompile(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the fixture must project so the deferral is a compile decision');
  return compilePython(verified);
}

// The linker is target neutral, so a jump fixture the linker refuses is refused identically on all
// three legs including Python: the refusal happens before the deferral pass ever runs.
export async function assertJumpAdmitted(name, source) {
  const row = await admission(source);
  assert.equal(row.projection, 'projected', name);
  assert.equal(row.rt1, 'admitted', `RT12J_LINK_REFUSED: ${name} must link on RT-1`);
  assert.equal(row.javascript, 'admitted', `RT12J_LINK_REFUSED: ${name} must link on the JavaScript leg`);
  return row;
}

// Hand-built linked jumps, so the two semantic walkers can be asked about a zero-field statement
// with no linker involvement: both reach `statementSubExpressions`, whose fallthrough returns
// `[statement.value]`, so at base they raise a TypeError independent of the linker's own route.
export function linkedBreakStatement() {
  return Object.freeze({ kind: 'break' });
}

export function linkedContinueStatement() {
  return Object.freeze({ kind: 'continue' });
}
