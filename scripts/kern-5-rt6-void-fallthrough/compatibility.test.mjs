import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  VOID_FALLTHROUGH,
  compileJavaScript,
  compilePython,
  LINKED_KIR_TYPE_ADMISSION,
  entryOf,
  envelopeBytes,
  linkedProgram,
  project,
  runtimeRequest,
  sha256Hex,
  text,
  threeLegs,
} from './k0-support.mjs';

const GOLDEN_URL = new URL('./k0-golden.json', import.meta.url);
const BUILD_GOLDEN_URL = new URL('./k0-build-golden.json', import.meta.url);
const RT2_GOLDEN_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);

const RT2_GOLDEN_SHA256 = '6d6754e75d5d9846a1201101831a528dfc7021374d4f1f6d5eacc0d6e0b8bff2';
const RT3_GOLDEN_SHA256 = '935da8148df5c02d5d405fea2db00fb7f5f6db08158d9cdca0d61c0084972b18';

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

// Behaviour rows: the linked shape and the envelope text every leg must agree on. These are
// invariants of the contract, so a change here is a behaviour change and never environment drift.
async function recomputeBehaviour() {
  const linked = await linkedProgram(VOID_FALLTHROUGH);
  const legs = await threeLegs(VOID_FALLTHROUGH, runtimeRequest('rt6-k0', {}));
  const envelope = Buffer.from(envelopeBytes(legs.direct.envelope)).toString('utf8');
  return {
    envelopeText: envelope,
    linkedReturnType: linked.program.returnType,
    typeAdmission: LINKED_KIR_TYPE_ADMISSION,
  };
}

// Build rows: digests over emitted bytes and over the projection of this source text. They move
// with the toolchain, so they are pinned apart from the behaviour rows and cannot mask one.
async function recomputeBuild() {
  const verified = await project(VOID_FALLTHROUGH);
  assert.ok(verified !== undefined, 'the K0 fixture must project');
  const linked = await linkedProgram(VOID_FALLTHROUGH);
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  assert.equal(javascript.outcome, 'success');
  assert.equal(python.outcome, 'success');
  return {
    javascriptArtifactSha256: javascript.artifact.sha256,
    linkedProgramSha256: linked.sha256,
    projectionArtifactSha256: linked.projectionArtifactSha256,
    pythonArtifactSha256: python.artifact.sha256,
  };
}

test('the RT-6 behaviour golden pins the linked shape, the type gate table and the envelope text', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  assert.deepEqual(
    await recomputeBehaviour(),
    golden,
    'RT6_K0_BEHAVIOUR_DRIFT: the linked shape, the closed type gate table or the envelope text changed',
  );
  assert.deepEqual(golden.linkedReturnType, { kind: 'void' });
  assert.equal(golden.typeAdmission.void.parameter, false, 'void is admitted in return position only');
  assert.equal(golden.typeAdmission.void.return, true);
});

test('the return gate rests on exactly one return-only row, and that row is void', () => {
  const returnOnly = Object.entries(LINKED_KIR_TYPE_ADMISSION)
    .filter(([, row]) => row.return && !row.parameter)
    .map(([kind]) => kind);
  assert.deepEqual(
    returnOnly,
    ['void'],
    'handlerReturnType recognises void as the one kind admitted in return position and refused in parameter position; a second such row would silently widen it',
  );
  for (const [kind, row] of Object.entries(LINKED_KIR_TYPE_ADMISSION)) {
    assert.ok(row.return, `${kind} must be admissible in return position`);
    assert.equal(row.scalar && !row.parameter, false, `${kind} must not be a scalar refused as a parameter`);
  }
});

test('the RT-6 build golden pins the emitted artifacts apart from the behaviour rows', async () => {
  const golden = JSON.parse(await readFile(BUILD_GOLDEN_URL, 'utf8'));
  assert.deepEqual(
    await recomputeBuild(),
    golden,
    'RT6_K0_BUILD_DRIFT: a projection, linked program or emitted artifact digest changed',
  );
  assert.notEqual(
    golden.javascriptArtifactSha256,
    golden.pythonArtifactSha256,
    'the two targets really are different artifacts, so the envelope identity is not vacuous',
  );
});

test('all three legs produce one envelope byte stream, recomputed rather than pinned once', async () => {
  const legs = await threeLegs(VOID_FALLTHROUGH, runtimeRequest('rt6-k0-identity', {}));
  const digests = ['direct', 'javascript', 'python'].map((leg) =>
    sha256Hex(Buffer.from(envelopeBytes(legs[leg].envelope))),
  );
  assert.equal(new Set(digests).size, 1, 'RT-1, emitted JavaScript and emitted Python must agree byte for byte');
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
