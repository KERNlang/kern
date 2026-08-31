import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boolArgs,
  compileJavaScript,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  handlerSource,
  project,
  provider,
  queueAbort,
  runtimeRequest,
} from './k0-support.mjs';

const FLAGS = Object.freeze([
  { name: 'flag', type: 'boolean' },
  { name: 'other', type: 'boolean' },
]);

const CONDITION_SOURCE = handlerSource('string', FLAGS, [
  'print value="\"before\""',
  'if cond="flag && other"',
  '  print value="\"inside\""',
  'return value="\"done\""',
]);

const NESTED_OPERAND_SOURCE = handlerSource('string', FLAGS, [
  'print value="\"before\""',
  'if cond="(flag || other) && (1 < 2)"',
  '  print value="\"inside\""',
  'return value="\"done\""',
]);

const SHORT_CIRCUIT_SOURCE = handlerSource('string', FLAGS, [
  'print value="\"before\""',
  'if cond="flag && (other == other)"',
  '  print value="\"inside\""',
  'return value="\"done\""',
]);

const QUEUE_DEPTHS = Object.freeze([0, 1, 2, 3, 4]);

const SOURCES = Object.freeze({
  'nested binary operands': { args: { flag: false, other: true }, source: NESTED_OPERAND_SOURCE },
  'short-circuited condition': { args: { flag: false, other: true }, source: SHORT_CIRCUIT_SOURCE },
  'whole binary condition': { args: { flag: true, other: true }, source: CONDITION_SOURCE },
});

for (const [name, fixture] of Object.entries(SOURCES)) {
  for (const depth of QUEUE_DEPTHS) {
    test(`RT-3 ${name} adds no RT-1-only checkpoint: abort queued at microtask depth ${depth}`, async () => {
      const verified = await project(fixture.source);
      assert.ok(verified !== undefined, 'F5 must project the tick-discipline source');
      const compiled = compileJavaScript(verified);
      assert.equal(compiled.outcome, 'success', `javascript compile failed: ${compiled.code}`);
      const request = runtimeRequest(`rt3-tick-${depth}`, boolArgs(fixture.args));
      const direct = await executeKernKir(verified, request, {
        ...provider([]),
        signal: queueAbort(depth),
      });
      const emitted = await executeJavaScriptChild(compiled.artifact.bytes, request, {
        abortAfterMicrotasks: depth,
      });
      assert.deepEqual(
        Buffer.from(envelopeBytes(emitted.envelope)),
        Buffer.from(envelopeBytes(direct)),
        'RT3_TICK_DISCIPLINE_DIVERGENCE: binary evaluation must not add an RT-1-only await point',
      );
    });
  }
}

test('RT-3 binary evaluation introduces no await inside the emitted expression lowering', async () => {
  const verified = await project(NESTED_OPERAND_SOURCE);
  const compiled = compileJavaScript(verified);
  assert.equal(compiled.outcome, 'success');
  const text = new TextDecoder().decode(compiled.artifact.bytes);
  const start = text.indexOf('const __runSpecialized');
  const end = text.indexOf('const execute=', start);
  assert.ok(start >= 0 && end > start, 'the emitted artifact must carry a specialized handler body');
  const awaited = [...text.slice(start, end).matchAll(/\bawait\b/gu)];
  assert.equal(awaited.length, 0, 'a capability-free RT-3 handler must contain no await in its specialized body');
});
