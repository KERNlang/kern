import assert from 'node:assert/strict';

import { projectKernModules, verifyKernProjection } from '../../packages/core/dist/frontend-projection.js';
import {
  LINKED_KIR_DEFAULT_CALL_POLICY,
  createLinkedKirClosureWalk,
  linkVerifiedKernKirProgram,
  linkedProgramHelpers,
  linkedStatementsCallDepth,
  linkedStatementsInvokeCapability,
} from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
import { KERN_KIR_RUNTIME_FORMAT, executeKernKir } from '../../packages/core/dist/runtime-kir.js';
import {
  ENTRY,
  LIMITS,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  executePythonChild,
  normalizeEnvelope,
  project,
  provider,
  queueAbort,
  runtimeRequest,
  threeLegs,
} from '../kern-5-rt2-boolean-if/k0-support.mjs';

export {
  ENTRY,
  LIMITS,
  LINKED_KIR_DEFAULT_CALL_POLICY,
  createLinkedKirClosureWalk,
  linkedProgramHelpers,
  linkedStatementsCallDepth,
  linkedStatementsInvokeCapability,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  executePythonChild,
  executeKernKir,
  linkVerifiedKernKirProgram,
  normalizeEnvelope,
  project,
  provider,
  queueAbort,
  runtimeRequest,
  threeLegs,
};

export function fnSource({ body, exported = 'false', name, parameters = [], returns }) {
  return [
    `fn name=${name} export=${exported} returns=${returns}`,
    ...parameters.map((parameter) => `  param name=${parameter.name} type=${parameter.type}`),
    '  handler lang=kern',
    ...body.map((line) => `    ${line}`),
    '',
  ].join('\n');
}

export function moduleSource(functions) {
  return functions.map((entry) => fnSource(entry)).join('');
}

export const BOOLEAN_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
export const TEXT_INPUT = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);

export const HELPER_IDENTITY = Object.freeze({
  body: Object.freeze(['return value="flag"']),
  name: 'helper',
  parameters: BOOLEAN_FLAG,
  returns: 'boolean',
});

export const HELPER_LABEL = Object.freeze({
  body: Object.freeze(['return value="t"']),
  name: 'label',
  parameters: TEXT_INPUT,
  returns: 'string',
});

export function entryFn(body, parameters = BOOLEAN_FLAG, returns = 'boolean') {
  return { body, exported: 'true', name: ENTRY.handlerName, parameters, returns };
}

export function callProgram(body, { helpers = [HELPER_IDENTITY], parameters = BOOLEAN_FLAG, returns = 'boolean' } = {}) {
  return moduleSource([...helpers, entryFn(body, parameters, returns)]);
}

export function boolArgs(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { tag: 'boolean', value }]));
}

export function stepRequest(requestId, args, maxSteps) {
  return {
    arguments: args,
    control: { preCancelled: false, timeoutMs: null },
    entry: ENTRY,
    format: KERN_KIR_RUNTIME_FORMAT,
    limits: { ...LIMITS, maxSteps },
    requestId,
  };
}

export async function projectModules(modules) {
  const request = { modules };
  const result = await projectKernModules(request);
  if (result.status !== 'projected') return undefined;
  return verifyKernProjection(request, result);
}

const LINK_CODES = Object.freeze([
  'handler-entry-ambiguous',
  'handler-entry-not-found',
  'handler-entry-unsupported',
  'handler-link-error',
  'projection-authentication-error',
]);

export async function admission(source) {
  const verified = Array.isArray(source) ? await projectModules(source) : await project(source);
  if (verified === undefined) {
    return { javascript: 'not-projected', projection: 'not-projected', python: 'not-projected', rt1: 'not-projected' };
  }
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  const direct = await executeKernKir(verified, runtimeRequest('rt4-admission', {}), provider([]));
  return {
    javascript: javascript.outcome === 'failure' ? javascript.code : 'admitted',
    projection: 'projected',
    python: python.outcome === 'failure' ? python.code : 'admitted',
    rt1:
      direct.outcome === 'failure' && LINK_CODES.includes(direct.diagnostics[0]?.code)
        ? direct.diagnostics[0].code
        : 'admitted',
    verified,
  };
}

export async function assertLinkRejected(source, label) {
  const row = await admission(source);
  assert.equal(row.projection, 'projected', `${label} must project so the negative is a link decision`);
  assert.equal(row.rt1, 'handler-entry-unsupported', label);
  assert.equal(row.javascript, 'handler-entry-unsupported', label);
  assert.equal(row.python, 'handler-entry-unsupported', label);
  return row;
}

export async function linkedProgram(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the fixture');
  const linked = linkVerifiedKernKirProgram(verified, ENTRY, LIMITS);
  assert.equal(linked.outcome, 'success', `link failed: ${linked.code}`);
  return linked.program;
}

export async function threeLegBytes(source, request) {
  const legs = await threeLegs(source, request);
  const direct = envelopeBytes(legs.direct.envelope);
  assert.deepEqual(
    Buffer.from(envelopeBytes(legs.javascript.envelope)),
    Buffer.from(direct),
    'emitted JavaScript diverged from RT-1',
  );
  assert.deepEqual(
    Buffer.from(envelopeBytes(legs.python.envelope)),
    Buffer.from(direct),
    'emitted Python diverged from RT-1',
  );
  return { bytes: direct, legs };
}

function firstSuccess(envelopes, budgets, label) {
  const index = envelopes.findIndex((envelope) => envelope.outcome === 'success');
  assert.ok(index >= 0, `${label}: no step budget in the scanned range produced a successful run`);
  assert.ok(
    envelopes.slice(index).every((envelope) => envelope.outcome === 'success'),
    `${label}: step consumption must be monotonic in the step budget`,
  );
  return budgets[index];
}

const BUDGETS = Object.freeze(Array.from({ length: 90 }, (_unused, index) => index + 1));

export async function directStepBudget(source, args, requestId) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the metering fixture');
  const envelopes = [];
  for (const maxSteps of BUDGETS) {
    envelopes.push(await executeKernKir(verified, stepRequest(`${requestId}-${maxSteps}`, args, maxSteps), provider([])));
  }
  const linkIndex = BUDGETS.findIndex(
    (maxSteps) => linkVerifiedKernKirProgram(verified, ENTRY, { ...LIMITS, maxSteps }).outcome === 'success',
  );
  assert.ok(linkIndex >= 0, 'no step budget in the scanned range linked the metering fixture');
  return { execution: firstSuccess(envelopes, BUDGETS, requestId) - BUDGETS[linkIndex], link: BUDGETS[linkIndex] };
}

const CHAIN_PARAMETERS = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);

export function helperChain(depth) {
  const helpers = [];
  for (let index = 0; index < depth; index += 1) {
    helpers.push({
      body: [index === 0 ? 'return value="flag"' : `return value="h${index - 1}(flag)"`],
      name: `h${index}`,
      parameters: CHAIN_PARAMETERS,
      returns: 'boolean',
    });
  }
  return moduleSource([...helpers, entryFn([`return value="h${depth - 1}(flag)"`], CHAIN_PARAMETERS)]);
}

export function helperLadder(width) {
  const helpers = [];
  for (let index = 0; index < width; index += 1) {
    const first = index - 1;
    const second = index - 2;
    const body =
      index === 0
        ? 'return value="flag"'
        : index === 1
          ? 'return value="h0(flag)"'
          : `return value="h${first}(flag) && h${second}(flag)"`;
    helpers.push({ body: [body], name: `h${index}`, parameters: CHAIN_PARAMETERS, returns: 'boolean' });
  }
  return moduleSource([...helpers, entryFn([`return value="h${width - 1}(flag)"`], CHAIN_PARAMETERS)]);
}

export function linkWithPolicy(verified, policy) {
  return linkVerifiedKernKirProgram(verified, ENTRY, LIMITS, policy);
}
