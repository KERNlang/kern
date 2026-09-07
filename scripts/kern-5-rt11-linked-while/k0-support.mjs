import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ENTRY,
  admission,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  project,
  stepRequest,
  provider,
} from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import {
  DEFERRAL_LABEL,
  LEDGER,
  ROW_KEYS,
  validateLedger,
} from '../kern-5-parity-ledger/ledger-support.mjs';

// An `export *` re-export does not bring a name into this module's own scope, so anything this file
// calls is imported by name as well as re-exported.
import { loopStepBudget } from '../kern-5-rt10-for/k0-support.mjs';

export * from '../kern-5-rt10-for/k0-support.mjs';

export { DEFERRAL_LABEL, LEDGER, ROW_KEYS, validateLedger };

const TABLE_URL = new URL('./behavior-table.json', import.meta.url);

export const BEHAVIOR_TABLE_RAW = readFileSync(TABLE_URL, 'utf8');
export const WHILE_TABLE_ROWS = Object.freeze(
  JSON.parse(BEHAVIOR_TABLE_RAW).rows.map((row) => Object.freeze({ ...row })),
);

export const LEDGER_ROW_VALUES = Object.freeze({
  blockedBy: Object.freeze([]),
  label: DEFERRAL_LABEL,
  nodeKind: 'while',
  since: 'kern-5-rt11-linked-while',
  spec: '.Codex/specs/kern-5-rt11-linked-while/spec.md',
  surface: 'statement',
});

export const WHILE_SPEC_URL = new URL('../../.Codex/specs/kern-5-rt11-linked-while/spec.md', import.meta.url);

// The fixture catalogue lives in its own module: the position, twin, meter and fence tables are
// data, and keeping them here would push this harness past the 500-line ceiling.
export * from './fixtures.mjs';

// Two legs, not three: the Python leg refuses every `while` program by ledger row, so
// `threeLegs`/`emittedArtifacts` (which assert a successful Python compile) are unusable here.
export async function twoLegs(source, request) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the fixture source');
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `RT11W_LINK_REFUSED: javascript compile failed: ${javascript.code}`);
  const directCalls = [];
  const direct = await executeKernKir(verified, request, provider(directCalls));
  const javascriptRun = await executeJavaScriptChild(javascript.artifact.bytes, request);
  return { direct: { calls: directCalls, envelope: direct }, javascript: javascriptRun };
}

export async function twoLegBytes(source, request) {
  const legs = await twoLegs(source, request);
  const direct = envelopeBytes(legs.direct.envelope);
  assert.deepEqual(
    Buffer.from(envelopeBytes(legs.javascript.envelope)),
    Buffer.from(direct),
    'RT11W_LEG_DIVERGENCE: emitted JavaScript diverged from RT-1',
  );
  return { bytes: direct, legs };
}

// The leg-identity gate item 1 demands, measured rather than derived. RT-1 links and executes under
// one budget, so its smallest succeeding `maxSteps` is `link + execution`; the emitted artifact is
// compiled once and its meter counts execution only. So the two legs charge identically exactly when
// the emitted artifact's own threshold equals RT-1's execution count — pinned from both sides, which
// is what makes it a threshold rather than a bound.
export async function assertTwoLegStepThreshold(name, source, args = {}) {
  const rt1 = await loopStepBudget(source, args, `rt11w-threshold-${name}`);
  const verified = await project(source);
  assert.ok(verified !== undefined, `${name} must project`);
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `RT11W_LINK_REFUSED: javascript compile failed: ${javascript.code}`);
  const runs = async (maxSteps) => {
    const request = stepRequest(`rt11w-threshold-${name}-${maxSteps}`, args, maxSteps);
    const run = await executeJavaScriptChild(javascript.artifact.bytes, request);
    return run.envelope.outcome === 'success';
  };
  assert.equal(
    await runs(rt1.execution),
    true,
    `RT11W_LEG_CHARGE_DRIFT: ${name} must succeed on the JavaScript leg at RT-1's execution count ${rt1.execution}`,
  );
  assert.equal(
    await runs(rt1.execution - 1),
    false,
    `RT11W_LEG_CHARGE_DRIFT: ${name} must fail one step under RT-1's execution count, so the legs share a threshold`,
  );
  return rt1;
}

export async function javascriptArtifact(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the fixture must project');
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `RT11W_LINK_REFUSED: javascript compile failed: ${javascript.code}`);
  return Buffer.from(javascript.artifact.bytes).toString('utf8');
}

export async function pythonCompile(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the fixture must project so the deferral is a compile decision');
  return compilePython(verified);
}

// The linker is target-neutral, so a `while` fixture the linker refuses is refused identically on
// all three legs, including Python: the refusal happens before the deferral pass ever runs. That is
// what lets the landed `assertLinkLabel` be reused unchanged for every negative row here.
export async function assertWhileAdmitted(name, source) {
  const row = await admission(source);
  assert.equal(row.projection, 'projected', name);
  assert.equal(row.rt1, 'admitted', `RT11W_LINK_REFUSED: ${name} must link on RT-1`);
  assert.equal(row.javascript, 'admitted', `RT11W_LINK_REFUSED: ${name} must link on the JavaScript leg`);
  return row;
}

// A hand-built linked `while` statement, so the two semantic walkers can be asked about a condition
// loop without depending on the linker admitting one first. Both throw a TypeError until they learn
// `while`, which is a cause independent of the linker's own route.
export function linkedWhileStatement({ body, condition } = {}) {
  return Object.freeze({
    body: Object.freeze(body ?? []),
    condition: condition ?? Object.freeze({ kind: 'literal', value: Object.freeze({ tag: 'boolean', value: true }) }),
    kind: 'while',
  });
}

export function linkedUserCall(handlerName) {
  return Object.freeze({ arguments: Object.freeze([]), handlerName, kind: 'user-call' });
}
