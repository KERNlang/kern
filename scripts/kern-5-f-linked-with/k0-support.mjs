import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { DEFERRAL_LABEL } from '../kern-5-parity-ledger/ledger-support.mjs';
import {
  ENTRY,
  LIMITS,
  abortingProvider,
  admission,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  linkVerifiedKernKirProgram,
  project as projectOnce,
  provider,
  pythonLegAdmissionColumn,
  runtimeRequest,
  stepRequest,
} from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import { assertLinkLabel, between } from '../kern-5-rt6-void-fallthrough/k0-support.mjs';
import { loopStepBudget } from '../kern-5-rt10-for/k0-support.mjs';
import { fixtureArguments } from '../kern-5-e-linked-each-do/k0-support.mjs';
import { BEHAVIOR_TABLE_FORMAT, PROBE_MATRIX_FORMAT, SPEC_PATH } from './pins.mjs';

export * from './fixtures.mjs';
export {
  BEHAVIOR_TABLE_FORMAT,
  DEFERRAL_LABEL,
  ENTRY,
  LIMITS,
  PROBE_MATRIX_FORMAT,
  abortingProvider,
  admission,
  assertLinkLabel,
  between,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  fixtureArguments,
  linkVerifiedKernKirProgram,
  loopStepBudget,
  provider,
  pythonLegAdmissionColumn,
  runtimeRequest,
  stepRequest,
};

// Projection is the dominant cost in this suite and every fixture is a pure function of its source
// text, so each distinct source is projected once per process. The promise, not the value, is
// cached: two callers racing on the same source must share one projection, never start two.
const PROJECTIONS = new Map();

export function project(source) {
  let pending = PROJECTIONS.get(source);
  if (pending === undefined) {
    pending = projectOnce(source);
    PROJECTIONS.set(source, pending);
  }
  return pending;
}

const require = createRequire(import.meta.url);

export const F_SPEC_PATH = SPEC_PATH;

const ROOT = new URL('../../', import.meta.url);
const BEHAVIOR_URL = new URL('./behavior-table.json', import.meta.url);
const PROBE_URL = new URL('./probe-matrix.json', import.meta.url);
const COMMIT_ROWS_URL = new URL('./commit-rows.json', import.meta.url);

export const BEHAVIOR_TABLE_RAW = readFileSync(BEHAVIOR_URL, 'utf8');
export const BEHAVIOR_ROWS = Object.freeze(
  JSON.parse(BEHAVIOR_TABLE_RAW).rows.map((row) => Object.freeze({ ...row })),
);
export const BEHAVIOR_TABLE = Object.freeze(JSON.parse(BEHAVIOR_TABLE_RAW));

export const PROBE_MATRIX = Object.freeze(JSON.parse(readFileSync(PROBE_URL, 'utf8')));

// Read lazily: a missing or malformed mapping must be one named failure in the row that consumes it,
// not a module-load crash that takes every other file in the suite down with it.
export function commitRowsRaw() {
  assert.ok(existsSync(COMMIT_ROWS_URL), 'F_COMMIT_ROWS_MISSING: commit-rows.json must exist');
  return readFileSync(COMMIT_ROWS_URL, 'utf8');
}

export function commitRows() {
  return JSON.parse(commitRowsRaw());
}

export function repositoryText(relativePath) {
  return readFileSync(new URL(relativePath, ROOT), 'utf8');
}

export function occurrencesOf(source, needle) {
  return source.split(needle).length - 1;
}

export function repositoryLineCount(relativePath) {
  return repositoryText(relativePath).split('\n').length - 1;
}

export function numstatAgainstBase(commit, path) {
  return execFileSync('git', ['diff', '--numstat', commit, '--', path], { cwd: ROOT, encoding: 'utf8' }).trim();
}

export function trackedFilesAt(commit, path) {
  return execFileSync('git', ['ls-tree', '-r', '--name-only', commit, '--', path], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((name) => name.length > 0)
    .sort();
}

// `--others` as well as the index: a brand new module that has not been staged yet is still a new
// module, and a chain stage the canonicalizer would have to learn.
export function trackedFilesNow(path) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', path], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((name) => name.length > 0)
    .sort();
}

export function linkedContracts() {
  return require('../../packages/core/dist/kir-runtime/linked-kir-program/contracts.js');
}

// The expansion is only observable on the linked program, so every structural row reads the entry
// handler's statement list rather than any emitted text.
export async function linkedEntryStatements(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F_PROJECTION_LOST: F5 must project the fixture source');
  const linked = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS);
  assert.equal(linked.outcome, 'success', `F_LINK_REFUSED: the fixture must link, and the linker returned ${linked.code}`);
  return linked.program.program.statements;
}

export function statementKinds(statements) {
  const kinds = [];
  const walk = (list) => {
    for (const statement of list) {
      kinds.push(statement.kind);
      for (const block of subBlocks(statement)) walk(block);
    }
  };
  walk(statements);
  return kinds;
}

function subBlocks(statement) {
  const { statementSubBlocks } = linkedContracts();
  return statementSubBlocks(statement);
}

// Two legs, not three: `with` expands into `try` and `do`, both of which carry a parity-ledger
// deferral, so every with fixture refuses at Python compile and can never claim a third leg.
export async function withTwoLegs(source, request) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F_PROJECTION_LOST: F5 must project the fixture source');
  const javascript = compileJavaScript(verified);
  assert.equal(
    javascript.outcome,
    'success',
    `F_LINK_REFUSED: the JavaScript leg refused the fixture with ${javascript.code}`,
  );
  const calls = [];
  const direct = await executeKernKir(verified, request, provider(calls));
  const javascriptRun = await executeJavaScriptChild(javascript.artifact.bytes, request);
  return { direct: { calls, envelope: direct }, javascript: javascriptRun };
}

export async function withTwoLegBytes(source, request) {
  const legs = await withTwoLegs(source, request);
  const direct = envelopeBytes(legs.direct.envelope);
  assert.deepEqual(
    Buffer.from(envelopeBytes(legs.javascript.envelope)),
    Buffer.from(direct),
    'F_LEG_DIVERGENCE: the emitted JavaScript envelope diverged from RT-1 byte for byte',
  );
  return { bytes: direct, legs };
}

export async function assertWithAdmitted(name, source) {
  const row = await admission(source);
  assert.equal(row.projection, 'projected', `F_PROJECTION_LOST: ${name} must project so admission is a link decision`);
  assert.equal(row.rt1, 'admitted', `F_LINK_REFUSED: ${name} must link on RT-1, and the linker refused it`);
  assert.equal(
    row.javascript,
    'admitted',
    `F_LINK_REFUSED: ${name} must link on the JavaScript leg, and the linker refused it`,
  );
  return row;
}

// The F5 wall is an assertion in its own right: a fixture the frontend refuses must never be
// credited to a link label, or the label looks covered while nothing exercises it.
export async function assertNotProjected(name, source) {
  const row = await admission(source);
  assert.equal(row.projection, 'not-projected', `F_F5_WALL_GONE: ${name} must stay outside F5, and it projected`);
  return row;
}

const MAX_SCANNED_STEPS = 400;

// An uncaught throw and a caught throw are both terminal completions that never report `success`, so
// "did the program run to its end" is the only predicate that meters every exit path with one rule.
export function completed(envelope) {
  return envelope.diagnostics.every((diagnostic) => diagnostic.code !== 'runtime-limit-exceeded');
}

async function smallest(predicate, label) {
  let low = 1;
  let high = MAX_SCANNED_STEPS;
  assert.equal(await predicate(high), true, `${label}: no budget in the scanned range completed the fixture`);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (await predicate(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

export async function completionBudget(source, args, requestId) {
  const verified = await project(source);
  assert.ok(verified !== undefined, `F_PROJECTION_LOST: ${requestId} must project`);
  const link = await smallest(
    async (maxSteps) => linkVerifiedKernKirProgram(verified, ENTRY, { ...LIMITS, maxSteps }).outcome === 'success',
    `${requestId} link`,
  );
  const total = await smallest(async (maxSteps) => {
    const envelope = await executeKernKir(verified, stepRequest(`${requestId}-${maxSteps}`, args, maxSteps), provider([]));
    return completed(envelope);
  }, `${requestId} execution`);
  return { execution: total - link, link, total };
}

export async function javascriptCompletionBudget(source, args, requestId) {
  const verified = await project(source);
  assert.ok(verified !== undefined, `F_PROJECTION_LOST: ${requestId} must project`);
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `F_LINK_REFUSED: ${requestId} failed the JavaScript compile: ${javascript.code}`);
  return smallest(async (maxSteps) => {
    const run = await executeJavaScriptChild(javascript.artifact.bytes, stepRequest(`${requestId}-${maxSteps}`, args, maxSteps));
    return completed(run.envelope);
  }, `${requestId} javascript`);
}

export async function assertThresholdParity(name, source, args = {}) {
  const rt1 = await completionBudget(source, args, `f-threshold-${name}`);
  const verified = await project(source);
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `F_LINK_REFUSED: ${name} failed the JavaScript compile: ${javascript.code}`);
  const runs = async (maxSteps) => {
    const run = await executeJavaScriptChild(
      javascript.artifact.bytes,
      stepRequest(`f-threshold-${name}-${maxSteps}`, args, maxSteps),
    );
    return completed(run.envelope);
  };
  assert.equal(
    await runs(rt1.execution),
    true,
    `F_LEG_CHARGE_DRIFT: ${name} must complete on the JavaScript leg at RT-1's execution count ${rt1.execution}`,
  );
  assert.equal(
    await runs(rt1.execution - 1),
    false,
    `F_LEG_CHARGE_DRIFT: ${name} must exhaust one step under RT-1's execution count, so the legs share a threshold`,
  );
  return rt1;
}

// RT-1 charges the link out of the same budget the emitted artifact never sees, so a starvation row
// that used one number for both legs would be comparing two different points in the program. Every
// fault row drives the two legs through here instead.
export async function legRunner(source, args, requestId) {
  const verified = await project(source);
  assert.ok(verified !== undefined, `F_PROJECTION_LOST: ${requestId} must project`);
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `F_LINK_REFUSED: ${requestId} failed the JavaScript compile: ${javascript.code}`);
  const rt1 = await completionBudget(source, args, requestId);
  const direct = async (steps) =>
    executeKernKir(verified, stepRequest(`${requestId}-rt-${steps}`, args, rt1.link + steps), provider([]));
  const absolute = async (steps) => ({
    direct: await direct(steps),
    emitted: (await executeJavaScriptChild(javascript.artifact.bytes, stepRequest(`${requestId}-js-${steps}`, args, steps)))
      .envelope,
  });
  return { absolute, at: async (delta) => absolute(rt1.execution + delta), direct, rt1 };
}

export function eventTexts(envelope) {
  return envelope.events.filter((event) => event.op === 'stdout').map((event) => event.text);
}

export function diagnosticCodes(envelope) {
  return envelope.diagnostics.map((diagnostic) => diagnostic.code);
}

export function specCriteria() {
  const spec = repositoryText(SPEC_PATH);
  const start = spec.indexOf('## Acceptance Criteria');
  const end = spec.indexOf('## Out of Scope');
  assert.ok(start >= 0 && end > start, 'F_SPEC_SHAPE: the Acceptance Criteria section must be locatable');
  const section = spec.slice(start, end);
  return {
    criteria: [...section.matchAll(/^- \[[ x]\] (.*)$/gmu)].map((match) => match[1].trim()),
    groups: [...section.matchAll(/^\*\*(.+?)\*\*$/gmu)].map((match) => match[1].trim()),
  };
}
