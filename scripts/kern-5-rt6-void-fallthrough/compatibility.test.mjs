import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  VOID_FALLTHROUGH,
  compileJavaScript,
  compilePython,
  entryOf,
  envelopeBytes,
  linkTypeGateLiterals,
  linkedProgram,
  project,
  runtimeRequest,
  sha256Hex,
  text,
  threeLegs,
} from './k0-support.mjs';

const GOLDEN_URL = new URL('./k0-golden.json', import.meta.url);
const RT2_GOLDEN_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);

const RT2_GOLDEN_SHA256 = 'aa7f116d1b5ad758f7b58f358c026f34c08232bd5311dee4d5ad1211e90afaa0';
const RT3_GOLDEN_SHA256 = 'ac690563c41feb50dc889c580de6cb763390484183c3795a513ec63a674a12cf';

const BOOLEAN_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
const TEXT_INPUT = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);

// RT-4's compatibility suite is an RT-6 gate and already pins the pre-slice digest of every
// call-free shape. These fixtures carry the complementary claim RT-4 cannot make: that no non-void
// linked encoding gained a field or a void return type.
const NON_VOID_FIXTURES = Object.freeze({
  branch: () =>
    entryOf(
      [
        'if cond="flag"',
        `  ${text('t')}`,
        '  return value="\\"then\\""',
        'else',
        `  ${text('f')}`,
        'return value="\\"else\\""',
      ],
      { parameters: BOOLEAN_FLAG, returns: 'string' },
    ),
  capability: () =>
    entryOf(
      [
        'capability namespace=fixture operation=resolve name=reply',
        'let name=out value="Json.stringify({ reply: reply, t: t })"',
        'print value="out"',
        'return value="out"',
      ],
      { parameters: TEXT_INPUT, returns: 'string' },
    ),
  literal: () => entryOf(['return value="true"'], { returns: 'boolean' }),
});

// Every row is recomputed from the real pipeline on each run, so a golden that was copied rather
// than produced by the layer it claims to pin cannot survive.
async function recompute() {
  const verified = await project(VOID_FALLTHROUGH);
  assert.ok(verified !== undefined, 'the K0 fixture must project');
  const linked = await linkedProgram(VOID_FALLTHROUGH);
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  assert.equal(javascript.outcome, 'success');
  assert.equal(python.outcome, 'success');
  const legs = await threeLegs(VOID_FALLTHROUGH, runtimeRequest('rt6-k0', {}));
  return {
    ...(await linkTypeGateLiterals()),
    directEnvelopeSha256: sha256Hex(Buffer.from(envelopeBytes(legs.direct.envelope))),
    javascriptArtifactSha256: javascript.artifact.sha256,
    javascriptEnvelopeSha256: sha256Hex(Buffer.from(envelopeBytes(legs.javascript.envelope))),
    linkedProgramSha256: linked.sha256,
    linkedReturnType: linked.program.returnType,
    projectionArtifactSha256: linked.projectionArtifactSha256,
    pythonArtifactSha256: python.artifact.sha256,
    pythonEnvelopeSha256: sha256Hex(Buffer.from(envelopeBytes(legs.python.envelope))),
  };
}

test('the RT-6 K0 golden pins every layer of the void completion', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  assert.deepEqual(
    await recompute(),
    golden,
    'RT6_K0_GOLDEN_DRIFT: a projection, linked program, artifact or envelope layer changed',
  );
  assert.equal(golden.directEnvelopeSha256, golden.javascriptEnvelopeSha256);
  assert.equal(golden.directEnvelopeSha256, golden.pythonEnvelopeSha256);
  assert.notEqual(
    golden.javascriptArtifactSha256,
    golden.pythonArtifactSha256,
    'the two targets really are different artifacts, so the envelope identity above is not vacuous',
  );
  assert.deepEqual(golden.linkedReturnType, { kind: 'void' });
});

test('no non-void linked program carries a void return type or an added field', async () => {
  for (const name of Object.keys(NON_VOID_FIXTURES).sort()) {
    const linked = await linkedProgram(NON_VOID_FIXTURES[name]());
    assert.notEqual(linked.program.returnType.kind, 'void', `${name} must keep its declared return type`);
    assert.deepEqual(
      Object.keys(linked.program).sort(),
      ['parameters', 'returnType', 'statements'],
      `${name} must not gain a handler field`,
    );
    assert.equal(linked.helpers, undefined, `${name} must stay call free`);
  }
});

test('the emitted non-void tail still fails closed when a handler never returns', async () => {
  const verified = await project(NON_VOID_FIXTURES.literal());
  assert.ok(
    Buffer.from(compileJavaScript(verified).artifact.bytes)
      .toString('utf8')
      .includes(`__Fault('handler-entry-unsupported','execution')`),
  );
  assert.ok(
    Buffer.from(compilePython(verified).artifact.bytes)
      .toString('utf8')
      .includes('raise _Fault("handler-entry-unsupported", "execution")'),
  );
});

test('the RT-2 and RT-3 K0 goldens are byte-identical: RT-6 adds no expression or statement kind', async () => {
  assert.equal(
    createHash('sha256').update(await readFile(RT2_GOLDEN_URL)).digest('hex'),
    RT2_GOLDEN_SHA256,
    'RT6_COMPATIBILITY_DRIFT: RT-6 must not touch the RT-2 golden',
  );
  assert.equal(
    createHash('sha256').update(await readFile(RT3_GOLDEN_URL)).digest('hex'),
    RT3_GOLDEN_SHA256,
    'RT6_COMPATIBILITY_DRIFT: RT-6 must not touch the RT-3 golden',
  );
  const rt3 = JSON.parse(await readFile(RT3_GOLDEN_URL, 'utf8'));
  assert.ok(!rt3.linkedExpressionKinds.includes('void'), 'void is a return type, never an expression kind');
});
