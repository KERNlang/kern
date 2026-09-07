import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { KERN_KIR_PYTHON_COMPILER_FORMAT } from '../../packages/core/dist/compiler/kir-python/contracts.js';
import { RuntimeMeter } from '../../packages/core/dist/kir-runtime/inspect.js';
import { linkVerifiedKernKirProgramOrThrow } from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
import {
  ENTRY,
  LIMITS,
  admission,
  compileJavaScript,
  compilePython,
  executeKernKir,
  fnSource,
  moduleSource,
  project,
  provider,
  runtimeRequest,
} from '../kern-5-rt4-user-fn-call/k0-support.mjs';
import { KIR_PYTHON_LEG_DEFERRED, PARITY_LEDGER_FORMAT } from './support.mjs';

export {
  ENTRY,
  LIMITS,
  admission,
  compileJavaScript,
  compilePython,
  executeKernKir,
  fnSource,
  moduleSource,
  project,
  provider,
  runtimeRequest,
};

export const LEDGER_URL = new URL('./parity-ledger.json', import.meta.url);
export const LEDGER_FORMAT = PARITY_LEDGER_FORMAT;
export const DEFERRAL_LABEL = KIR_PYTHON_LEG_DEFERRED;
export const LEDGER_SHA256 = '2b372e6ee575231ebf6cf1e845353197a4c55aafc49bf4db7e0a0b40f0cb35fa';

export const LEDGER_KEYS = Object.freeze(['format', 'label', 'rows']);
export const ROW_KEYS = Object.freeze(['blockedBy', 'label', 'nodeKind', 'since', 'spec', 'surface']);
export const SURFACES = Object.freeze(['expression', 'statement']);

const SLICE_ID = /^kern-5-[a-z0-9]+(-[a-z0-9]+)*$/u;
const SPEC_PATH = /^\.Codex\/specs\/kern-5-[a-z0-9]+(-[a-z0-9]+)*\/spec\.md$/u;
const KIND = /^[a-z]+(-[a-z]+)*$/u;
const REPO_ROOT = new URL('../../', import.meta.url);

const CONTRACTS_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts', import.meta.url);
const REQUEST_SOURCE_URL = new URL('../../packages/core/src/compiler/kir-python/request.ts', import.meta.url);
const INDEX_SOURCE_URL = new URL('../../packages/core/src/compiler/kir-python/index.ts', import.meta.url);
const PYTHON_CONTRACTS_URL = new URL('../../packages/core/src/compiler/kir-python/contracts.ts', import.meta.url);
const REQUEST_MODULE = '../../packages/core/dist/compiler/kir-python/request.js';
const INDEX_MODULE = '../../packages/core/dist/compiler/kir-python/index.js';
const PYTHON_CONTRACTS_MODULE = '../../packages/core/dist/compiler/kir-python/contracts.js';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function source(url) {
  return readFileSync(url, 'utf8');
}

export const LEDGER_RAW = readFileSync(LEDGER_URL);
export const LEDGER = JSON.parse(LEDGER_RAW.toString('utf8'));

export function requestSource() {
  return source(REQUEST_SOURCE_URL);
}

export function indexSource() {
  return source(INDEX_SOURCE_URL);
}

export function pythonContractsSource() {
  return source(PYTHON_CONTRACTS_URL);
}

function fail(message) {
  throw new TypeError(`parity ledger rejection: ${message}`);
}

function plainKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must carry exactly ${wanted.join(', ')}`);
  }
}

// The ledger's own schema gate. It lives here rather than in `packages/core/src` on purpose: the
// ledger is oracle-side evidence, and the compiled-core inventory is pinned at 354 files.
export function validateLedger(document) {
  plainKeys(document, LEDGER_KEYS, 'the parity ledger');
  if (document.format !== LEDGER_FORMAT) fail(`the parity ledger format must be ${LEDGER_FORMAT}`);
  if (document.label !== DEFERRAL_LABEL) fail(`the parity ledger label must be ${DEFERRAL_LABEL}`);
  if (!Array.isArray(document.rows)) fail('the parity ledger rows must be an array');
  const kinds = [];
  for (const row of document.rows) {
    plainKeys(row, ROW_KEYS, 'a parity ledger row');
    if (typeof row.nodeKind !== 'string' || !KIND.test(row.nodeKind)) fail('a row nodeKind must be a linked node kind');
    if (!SURFACES.includes(row.surface)) fail(`a row surface must be one of ${SURFACES.join(', ')}`);
    if (row.label !== document.label) fail('a row label must equal the ledger label');
    if (typeof row.since !== 'string' || !SLICE_ID.test(row.since)) fail('a row since must be a kern-5 slice id');
    if (typeof row.spec !== 'string' || !SPEC_PATH.test(row.spec)) fail('a row spec must be a kern-5 slice spec path');
    if (!existsSync(new URL(row.spec, REPO_ROOT))) fail(`a row spec must exist: ${row.spec}`);
    if (!Array.isArray(row.blockedBy)) fail('a row blockedBy must be an array');
    kinds.push(row.nodeKind);
  }
  if (kinds.some((kind, index) => index > 0 && kinds[index - 1] >= kind)) {
    fail('the parity ledger rows must be sorted by nodeKind and unique');
  }
  const present = new Set(kinds);
  for (const row of document.rows) {
    for (const blocker of row.blockedBy) {
      if (typeof blocker !== 'string' || !present.has(blocker)) fail('a row blockedBy must name another ledger row');
      if (blocker === row.nodeKind) fail('a row must not block itself');
    }
  }
  return document;
}

export function ledgerRows() {
  return validateLedger(structuredClone(LEDGER)).rows;
}

function unionKinds(text, declaration, label) {
  const start = text.indexOf(declaration);
  assert.ok(start >= 0, `contracts.ts must declare ${label}`);
  const end = text.indexOf('\nexport ', start + 1);
  assert.ok(end > start, `the ${label} union must be followed by another export`);
  const kinds = [...text.slice(start, end).matchAll(/readonly kind: '([a-z-]+)'/gu)].map((match) => match[1]);
  assert.ok(kinds.length > 0, `the ${label} union must carry discriminant literals`);
  return Object.freeze([...new Set(kinds)].sort());
}

export function linkedKinds() {
  const text = source(CONTRACTS_URL);
  return Object.freeze({
    expression: unionKinds(text, 'export type LinkedKernKirExpression =', 'LinkedKernKirExpression'),
    statement: unionKinds(text, 'export type LinkedKernKirStatement =', 'LinkedKernKirStatement'),
  });
}

async function exported(specifier, name, hint) {
  const module = await import(new URL(specifier, import.meta.url).href);
  assert.ok(module[name] !== undefined, `PARITY_LEDGER_MISSING_EXPORT: ${hint} must export ${name}`);
  return module[name];
}

export async function statementLowering() {
  return exported(REQUEST_MODULE, 'KIR_PYTHON_STATEMENT_LOWERING', 'compiler/kir-python/request.js');
}

export async function expressionLowering() {
  return exported(REQUEST_MODULE, 'KIR_PYTHON_EXPRESSION_LOWERING', 'compiler/kir-python/request.js');
}

export async function loweringTable() {
  return exported(REQUEST_MODULE, 'KIR_PYTHON_LOWERING', 'compiler/kir-python/request.js');
}

export async function loweringDeferral() {
  return exported(REQUEST_MODULE, 'pythonLoweringDeferral', 'compiler/kir-python/request.js');
}

export async function compileWithLowering() {
  return exported(INDEX_MODULE, 'compileKernKirToPythonWithLowering', 'compiler/kir-python/index.js');
}

export async function deferralCode() {
  return exported(PYTHON_CONTRACTS_MODULE, 'KIR_PYTHON_LEG_DEFERRED_CODE', 'compiler/kir-python/contracts.js');
}

export function compilerRequest(overrides = {}) {
  return { entry: ENTRY, format: KERN_KIR_PYTHON_COMPILER_FORMAT, limits: LIMITS, ...overrides };
}

export async function linked(text) {
  const verified = await project(text);
  assert.ok(verified !== undefined, 'the fixture must project so the deferral is a compile decision');
  return linkVerifiedKernKirProgramOrThrow(verified, ENTRY, new RuntimeMeter(LIMITS));
}

export async function verified(text) {
  const value = await project(text);
  assert.ok(value !== undefined, 'the fixture must project so the deferral is a compile decision');
  return value;
}

export function injectedLowering(table, surface, kind, state) {
  assert.ok(SURFACES.includes(surface), `the injected surface must be a real surface, not ${surface}`);
  assert.ok(Object.hasOwn(table[surface], kind), `the injected mapping must override a real kind, not ${kind}`);
  return Object.freeze({ ...table, [surface]: Object.freeze({ ...table[surface], [kind]: state }) });
}

export function assertNoPythonArtifact(result, label) {
  assert.equal(result.outcome, 'failure', `${label}: a deferred node must not compile`);
  assert.deepEqual(Object.keys(result).sort(), ['code', 'format', 'outcome'], `${label}: the refusal shape moved`);
  assert.equal(Object.hasOwn(result, 'artifact'), false, `${label}: a refusal must carry no Python artifact`);
  assert.equal(Object.hasOwn(result, 'manifest'), false, `${label}: a refusal must carry no Python manifest`);
  assert.equal(result.format, KERN_KIR_PYTHON_COMPILER_FORMAT, `${label}: the compiler format moved`);
  return result.code;
}

const ACC = 'let name=acc value="0"';
const RETURN_ACC = 'return value="acc"';
const LOOP = Object.freeze(['for name=i from="0" to="3"', '  assign target="acc" value="acc + i"']);

function entryProgram(body, { helpers = [], parameters = [], returns = 'integer' } = {}) {
  return moduleSource([...helpers, { body, exported: 'true', name: ENTRY.handlerName, parameters, returns }]);
}

export const IDENTITY_HELPER = Object.freeze({
  body: Object.freeze(['return value="a"']),
  name: 'idp',
  parameters: Object.freeze([Object.freeze({ name: 'a', type: 'integer' })]),
  returns: 'integer',
});

const LOOP_HELPER = Object.freeze({
  body: Object.freeze([ACC, ...LOOP, RETURN_ACC]),
  name: 'sumto',
  parameters: Object.freeze([]),
  returns: 'integer',
});

// Every catalog-permitted parent position a `for` statement reaches today. The negative probe walks
// all of them, so a deferral that fires only at the handler's top level cannot pass.
export const STATEMENT_POSITIONS = Object.freeze({
  'for-body': () => entryProgram([ACC, 'for name=o from="0" to="2"', ...LOOP.map((line) => `  ${line}`), RETURN_ACC]),
  'handler-top-level': () => entryProgram([ACC, ...LOOP, RETURN_ACC]),
  'helper-body': () => entryProgram(['return value="sumto()"'], { helpers: [LOOP_HELPER] }),
  'if-else': () =>
    entryProgram([
      ACC,
      'if cond="false"',
      '  assign target="acc" value="1"',
      'else',
      ...LOOP.map((line) => `  ${line}`),
      RETURN_ACC,
    ]),
  'if-then': () => entryProgram([ACC, 'if cond="true"', ...LOOP.map((line) => `  ${line}`), RETURN_ACC]),
});

const BOUND_BODY = Object.freeze(['  assign target="acc" value="acc + i"']);

// Every expression position a `binary` reaches today, measured. A deferral that fires only at the
// shallowest position cannot pass this matrix: `record-value` and `member-source-record` sit two
// and three levels under the statement that holds them.
export const EXPRESSION_POSITIONS = Object.freeze({
  'assign-value': () => entryProgram([ACC, 'assign target="acc" value="acc + 1"', RETURN_ACC]),
  'call-argument': () => entryProgram(['return value="idp(1 + 1)"'], { helpers: [IDENTITY_HELPER] }),
  'for-from': () => entryProgram([ACC, 'for name=i from="0 + 0" to="3"', ...BOUND_BODY, RETURN_ACC]),
  'for-step': () => entryProgram([ACC, 'for name=i from="0" to="6" step="1 + 1"', ...BOUND_BODY, RETURN_ACC]),
  'for-to': () => entryProgram([ACC, 'for name=i from="0" to="1 + 2"', ...BOUND_BODY, RETURN_ACC]),
  'if-condition': () => entryProgram([ACC, 'if cond="1 < 2"', '  assign target="acc" value="1"', RETURN_ACC]),
  'json-call-argument': () =>
    entryProgram(['let name=s value="Json.stringify(1 + 1)"', 'return value="s"'], { returns: 'string' }),
  'let-value': () => entryProgram(['let name=x value="1 + 1"', 'return value="x"']),
  'list-item': () => entryProgram(['let name=xs value="[1 + 1]"', 'return value="1"']),
  'member-source-record': () =>
    entryProgram(['let name=r value="{ a: 1 + 1 }"', 'let name=v value="r.a"', 'return value="v"']),
  'print-value': () => entryProgram(['print value="Json.stringify(1 + 1)"', 'return value="1"']),
  'record-value': () => entryProgram(['let name=r value="{ a: 1 + 1 }"', 'return value="1"']),
  'return-value': () => entryProgram(['return value="1 + 1"']),
});

// Two positions a `binary` does not reach on this base. Both are fences, not exemptions: if either
// starts to link or project, the position matrix above is incomplete and must grow with it.
export const POSITION_FENCES = Object.freeze({
  'capability-input': {
    build: () =>
      entryProgram([
        'capability namespace=fixture operation=resolve name=reply input="Json.stringify(1 + 1)"',
        'return value="1"',
      ]),
    projection: 'not-projected',
  },
  'unary-argument': {
    build: () => entryProgram(['let name=b value="!(1 < 2)"', 'return value="1"']),
    projection: 'projected',
    python: 'handler-entry-unsupported',
  },
});
