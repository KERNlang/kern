import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { DEFERRAL_LABEL } from '../kern-5-parity-ledger/ledger-support.mjs';
import {
  ENTRY,
  LIMITS,
  admission,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  linkVerifiedKernKirProgram,
  project,
  provider,
  runtimeRequest,
  stepRequest,
} from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import { assertLinkLabel, between } from '../kern-5-rt6-void-fallthrough/k0-support.mjs';
import { loopStepBudget } from '../kern-5-rt10-for/k0-support.mjs';
import { SPEC_PATH } from './pins.mjs';

export * from './fixtures.mjs';
export {
  ENTRY,
  LIMITS,
  admission,
  assertLinkLabel,
  between,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  linkVerifiedKernKirProgram,
  loopStepBudget,
  project,
  provider,
  runtimeRequest,
  stepRequest,
};

const require = createRequire(import.meta.url);

export const E_SPEC_PATH = SPEC_PATH;
export const E_SPEC_URL = new URL(`../../${SPEC_PATH}`, import.meta.url);

const BEHAVIOR_URL = new URL('./behavior-table.json', import.meta.url);
const PROBE_URL = new URL('./probe-matrix.json', import.meta.url);
const COMMIT_ROWS_URL = new URL('./commit-rows.json', import.meta.url);

export const BEHAVIOR_TABLE_RAW = readFileSync(BEHAVIOR_URL, 'utf8');
export const BEHAVIOR_ROWS = Object.freeze(
  JSON.parse(BEHAVIOR_TABLE_RAW).rows.map((row) => Object.freeze({ ...row })),
);

export const PROBE_MATRIX = Object.freeze(JSON.parse(readFileSync(PROBE_URL, 'utf8')));

// Read lazily: a missing or malformed mapping must be one named failure in the row that consumes it,
// not a module-load crash that takes every other file in the suite down with it.
export function commitRowsRaw() {
  assert.ok(existsSync(COMMIT_ROWS_URL), 'E_COMMIT_ROWS_MISSING: commit-rows.json must exist');
  return readFileSync(COMMIT_ROWS_URL, 'utf8');
}

export function commitRows() {
  return JSON.parse(commitRowsRaw());
}

const TEXT = (value) => Object.freeze({ tag: 'text', value });
const INT = (value) => Object.freeze({ tag: 'integer', value });
const LIST = (items) => Object.freeze({ tag: 'list', value: Object.freeze(items) });

const LIST_LENGTHS = Object.freeze({ 'empty-list': 0, 'one-element': 1, 'three-elements': 3 });

const SCALARS = Object.freeze({
  a: INT('2'),
  flag: Object.freeze({ tag: 'boolean', value: true }),
  t: TEXT('seed'),
});

// One argument table for every fixture, keyed off the entry's own parameter list so a renamed
// parameter is a named failure instead of a silently argument-less run.
export function fixtureArguments(source, length = 'one-element') {
  const size = LIST_LENGTHS[length];
  assert.equal(typeof size, 'number', `E_ARGUMENT_TABLE: no pinned list length named ${length}`);
  const entryAt = source.lastIndexOf('fn name=');
  const names = [...source.slice(entryAt).matchAll(/^\s*param name=([A-Za-z0-9_]+)/gmu)].map((match) => match[1]);
  const args = {};
  for (const name of names) {
    if (name === 'xs') args[name] = LIST(Array.from({ length: size }, (_unused, index) => TEXT(`e${index}`)));
    else if (name === 'ns') args[name] = LIST(Array.from({ length: size }, (_unused, index) => INT(String(index + 1))));
    else if (name === 'bs') args[name] = LIST(Array.from({ length: size }, (_unused, index) => Object.freeze({ tag: 'boolean', value: index % 2 === 0 })));
    else {
      assert.ok(name in SCALARS, `E_ARGUMENT_TABLE: no pinned argument for parameter ${name}`);
      args[name] = SCALARS[name];
    }
  }
  return args;
}

export const LEDGER_DO_ROW = Object.freeze({
  blockedBy: Object.freeze([]),
  label: DEFERRAL_LABEL,
  nodeKind: 'do',
  since: 'kern-5-e',
  spec: SPEC_PATH,
  surface: 'statement',
});

// `each` waits on nothing the ledger tracks: it is a loop of its own, not a variant of `while`. `do`
// is listed as its blocker only where a fixture uses one inside the other, which the ledger does not
// model, so both rows stand alone.
export const LEDGER_EACH_ROW = Object.freeze({
  blockedBy: Object.freeze([]),
  label: DEFERRAL_LABEL,
  nodeKind: 'each',
  since: 'kern-5-e',
  spec: SPEC_PATH,
  surface: 'statement',
});

export const LEDGER_E_ROWS = Object.freeze([LEDGER_DO_ROW, LEDGER_EACH_ROW]);

export function repositoryText(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

export function occurrencesOf(source, needle) {
  return source.split(needle).length - 1;
}

export function repositoryLineCount(relativePath) {
  return repositoryText(relativePath).split('\n').length - 1;
}

// Two legs, not three: both new kinds are Python-deferred by ledger row, so a fixture carrying one
// refuses at Python compile and can never claim a three-leg envelope.
export async function eachTwoLegs(source, request) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'E_PROJECTION_LOST: F5 must project the fixture source');
  const javascript = compileJavaScript(verified);
  assert.equal(
    javascript.outcome,
    'success',
    `E_LINK_REFUSED: the JavaScript leg refused the fixture with ${javascript.code}`,
  );
  const calls = [];
  const direct = await executeKernKir(verified, request, provider(calls));
  const javascriptRun = await executeJavaScriptChild(javascript.artifact.bytes, request);
  return { direct: { calls, envelope: direct }, javascript: javascriptRun };
}

export async function eachTwoLegBytes(source, request) {
  const legs = await eachTwoLegs(source, request);
  const direct = envelopeBytes(legs.direct.envelope);
  assert.deepEqual(
    Buffer.from(envelopeBytes(legs.javascript.envelope)),
    Buffer.from(direct),
    'E_LEG_DIVERGENCE: the emitted JavaScript envelope diverged from RT-1 byte for byte',
  );
  return { bytes: direct, legs };
}

export async function assertEachAdmitted(name, source) {
  const row = await admission(source);
  assert.equal(row.projection, 'projected', `E_PROJECTION_LOST: ${name} must project so admission is a link decision`);
  assert.equal(row.rt1, 'admitted', `E_LINK_REFUSED: ${name} must link on RT-1, and the linker refused it`);
  assert.equal(
    row.javascript,
    'admitted',
    `E_LINK_REFUSED: ${name} must link on the JavaScript leg, and the linker refused it`,
  );
  return row;
}

// The F5 wall is an assertion in its own right: a fixture the frontend refuses must never be
// credited to a link label, or the label looks covered while nothing exercises it.
export async function assertNotProjected(name, source) {
  const row = await admission(source);
  assert.equal(
    row.projection,
    'not-projected',
    `E_F5_WALL_GONE: ${name} must stay outside F5, and it projected`,
  );
  return row;
}

export async function assertStepThreshold(name, source, args = {}) {
  const rt1 = await loopStepBudget(source, args, `e-threshold-${name}`);
  const verified = await project(source);
  assert.ok(verified !== undefined, `E_PROJECTION_LOST: ${name} must project`);
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `E_LINK_REFUSED: ${name} failed the JavaScript compile: ${javascript.code}`);
  const runs = async (maxSteps) => {
    const request = stepRequest(`e-threshold-${name}-${maxSteps}`, args, maxSteps);
    const run = await executeJavaScriptChild(javascript.artifact.bytes, request);
    return run.envelope.outcome === 'success';
  };
  assert.equal(
    await runs(rt1.execution),
    true,
    `E_LEG_CHARGE_DRIFT: ${name} must succeed on the JavaScript leg at RT-1's execution count ${rt1.execution}`,
  );
  assert.equal(
    await runs(rt1.execution - 1),
    false,
    `E_LEG_CHARGE_DRIFT: ${name} must fail one step under RT-1's execution count, so the legs share a threshold`,
  );
  return rt1;
}

export function runtimeWalker() {
  return require('../../packages/core/dist/kir-runtime/statement-walker.js');
}

export function linkedContracts() {
  return require('../../packages/core/dist/kir-runtime/linked-kir-program/contracts.js');
}

export function specCriteria() {
  const spec = readFileSync(E_SPEC_URL, 'utf8');
  const start = spec.indexOf('## Acceptance Criteria');
  const end = spec.indexOf('## Out of Scope');
  assert.ok(start >= 0 && end > start, 'E_SPEC_SHAPE: the Acceptance Criteria section must be locatable');
  const section = spec.slice(start, end);
  return {
    criteria: [...section.matchAll(/^- \[[ x]\] (.*)$/gmu)].map((match) => match[1].trim()),
    groups: [...section.matchAll(/^\*\*(.+?)\*\*$/gmu)].map((match) => match[1].trim()),
  };
}
