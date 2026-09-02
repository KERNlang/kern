import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { canonicalJson } from '../kern-5-rt2-boolean-if/k0-support.mjs';
import { compileJavaScript, compilePython, entryFn, linkedProgram, moduleSource, project } from './k0-support.mjs';

const RT2_GOLDEN_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);

const RT2_GOLDEN_SHA256 = 'cc7fb869d3f51ca6222521df52dd70e2364a83c8f97365f8db0a8c83cc2f9908';
const RT3_PRE_SLICE_SHA256 = '170faec94790627b1d453f05243799aaf6b788dd9c84f61243b67176727df226';

const BOOLEAN_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
const TEXT_INPUT = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);

const CALL_FREE_FIXTURES = Object.freeze({
  binary: () =>
    moduleSource([
      entryFn(['return value="flag && (other == other)"'], [...BOOLEAN_FLAG, { name: 'other', type: 'boolean' }]),
    ]),
  branch: () =>
    moduleSource([
      entryFn(
        [
          'if cond="flag"',
          '  print value="\\"t\\""',
          '  return value="\\"then\\""',
          'else',
          '  print value="\\"f\\""',
          'return value="\\"else\\""',
        ],
        BOOLEAN_FLAG,
        'string',
      ),
    ]),
  capability: () =>
    moduleSource([
      entryFn(
        [
          'capability namespace=fixture operation=resolve name=reply',
          'let name=out value="Json.stringify({ reply: reply, t: t })"',
          'print value="out"',
          'return value="out"',
        ],
        TEXT_INPUT,
        'string',
      ),
    ]),
  literal: () => moduleSource([entryFn(['return value="true"'], [])]),
  ordering: () => moduleSource([entryFn(['return value="1 < 2"'], [])]),
});

const PRE_SLICE_DIGESTS = Object.freeze({
  binary: {
    javascriptArtifactSha256: '51fd2e7c6925b8f42e75c1eab6bbf45b976491192e2125f291c141a1e7525dcd',
    javascriptManifestSha256: 'ebb3ecc5561d1a58d6c4f1fb1d5b81a4c7b82f5ea53ae79007fb09927077a744',
    linkedProgramSha256: '81872ecb59e44fd79b868b297c8bb5660756ee76bd46b16a1ad8ed65bb3a8112',
    pythonArtifactSha256: 'c969a46e5064cad917263c3dac2c1a3986a81ff3cc702978b7b885fe40ffc459',
    pythonManifestSha256: 'ebfef3ffcb8ccd660407a44dbb0425ca8bc0d181facf562f9fb8869286c97f28',
  },
  branch: {
    javascriptArtifactSha256: '627416fcc40103fefc146d27ff9f67a725cce23043fbe1ac8c85808b97abfc38',
    javascriptManifestSha256: '6d04430ed77f59bb26d3f4722406a7a8fbeb694865d5e6cd216d33a8fac2afbb',
    linkedProgramSha256: '8741ef79c2d35b0f1be4f3393727d17b25729ad2cb70233b5a93314f799aff7f',
    pythonArtifactSha256: '4202c62204aac3d1c83edc91a2deb2ec8eca769681ac2ee8212e09eb04e6a4da',
    pythonManifestSha256: '5d19f7960030f18f0356a13036e9e4afebc875f5b473e1eba779aac5fb773bc7',
  },
  capability: {
    javascriptArtifactSha256: '546b52eb356d298795dfeda289d67c28fe1014e122a58bec813fb51a76c7e57c',
    javascriptManifestSha256: 'c1a8c79341e85488fdbf07237fa7140d2c5d25637a905557eaa369f402cc982e',
    linkedProgramSha256: 'd2e11a853f6cc21bf7e9895580cec12c821646e4916206a47f343a0bfb3c2b9b',
    pythonArtifactSha256: '5ba7f970142931fb74fcbcd3951940ae39365d9fdb5638c6d6ce92db687fc1a4',
    pythonManifestSha256: '61d23e017aeb965f05328c44eea18f5b25039c6d34cea810be96b0f8c55eb6b1',
  },
  literal: {
    javascriptArtifactSha256: 'f9fbe5cde875d28567a27ada11fe7a99dfa12c6114c99e18e48ed4833c64fa86',
    javascriptManifestSha256: '277f4f8c24359cb1d08dd7a93448b753c7c626e8d5c250688e3b4b0af908bdc9',
    linkedProgramSha256: 'da5c688ae729e4961f987d63313f9e0c2714b37d668d644c6900860f035e613f',
    pythonArtifactSha256: 'f456f5b365ed978269a414e2de862e8fc13fc43c4a2e4d1bd61c58c074c4948b',
    pythonManifestSha256: '647991f3d743d08be985bea07d1da9b8e7b7c74b73a4f36705d2168d72c7e827',
  },
  ordering: {
    javascriptArtifactSha256: 'f08c40daa93594a68a97e6e39338c0d0ba2f8ac2fa0dbdcd3eec458ace0413e1',
    javascriptManifestSha256: '9537e8098d7be76d182650e77c85d42547a5c23e2845cae9143a2383de70c69e',
    linkedProgramSha256: '4f9c0beae2e50a32208cc947aaf43af6840a7adc5bd84efb4f3bb116de949d85',
    pythonArtifactSha256: 'b07167211e6c319a32ae6a405455d7a1142b1dd2af980e7ca2ae5d27e88a36ef',
    pythonManifestSha256: '5ae00ee892a247a2dbb931d860d036a68cece610b441cc1f372faaf2bc89c621',
  },
});

async function digests(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the compatibility fixture must project');
  const linked = await linkedProgram(source);
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  assert.equal(javascript.outcome, 'success');
  assert.equal(python.outcome, 'success');
  return {
    javascriptArtifactSha256: javascript.artifact.sha256,
    javascriptManifestSha256: javascript.manifest.sha256,
    linkedProgramSha256: linked.sha256,
    pythonArtifactSha256: python.artifact.sha256,
    pythonManifestSha256: python.manifest.sha256,
  };
}

test('every call-free digest is byte-identical to the pre-slice build', async () => {
  for (const name of Object.keys(PRE_SLICE_DIGESTS).sort()) {
    assert.deepEqual(
      await digests(CALL_FREE_FIXTURES[name]()),
      PRE_SLICE_DIGESTS[name],
      `RT4_COMPATIBILITY_DRIFT: ${name} changed the linked encoding or an emitted artifact`,
    );
  }
});

test('no call-free program carries a helpers field, so the linked encoding is unchanged', async () => {
  for (const name of Object.keys(CALL_FREE_FIXTURES).sort()) {
    const program = await linkedProgram(CALL_FREE_FIXTURES[name]());
    assert.equal(program.helpers, undefined, `${name} must not serialize an empty helpers field`);
  }
});

function linkedShape(program) {
  return canonicalJson({
    entry: program.entry,
    format: program.format,
    helpers: program.helpers,
    program: program.program,
  });
}

test('the helpers field is name-sorted and the linked shape does not depend on source order', async () => {
  const first = { body: ['return value="flag"'], name: 'alpha', parameters: BOOLEAN_FLAG, returns: 'boolean' };
  const second = { body: ['return value="flag"'], name: 'omega', parameters: BOOLEAN_FLAG, returns: 'boolean' };
  const entry = entryFn(['return value="omega(flag) && alpha(flag)"']);
  const forward = await linkedProgram(moduleSource([first, second, entry]));
  const reversed = await linkedProgram(moduleSource([second, first, entry]));
  for (const program of [forward, reversed]) {
    assert.deepEqual(
      program.helpers.map((helper) => helper.name),
      ['alpha', 'omega'],
    );
  }
  assert.equal(
    linkedShape(forward),
    linkedShape(reversed),
    'helper declaration order must not change the linked program shape',
  );
  assert.notEqual(
    forward.projectionArtifactSha256,
    reversed.projectionArtifactSha256,
    'the two fixtures really are different source texts, so the invariance above is not vacuous',
  );
  assert.equal(
    forward.helpers[0].name,
    'alpha',
    'the entry reaches omega first, so name sorting - not resolution order - decides the serialized order',
  );
});

test('a program that only links a helper it never reaches carries no helper at all', async () => {
  const program = await linkedProgram(
    moduleSource([
      { body: ['return value="flag"'], name: 'unreached', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      entryFn(['return value="flag"']),
    ]),
  );
  assert.equal(program.helpers, undefined, 'only the reachable closure is linked');
});

test('the RT-2 K0 golden is byte-identical and the RT-3 K0 golden changed additively only', async () => {
  const rt2 = await readFile(RT2_GOLDEN_URL);
  assert.equal(
    createHash('sha256').update(rt2).digest('hex'),
    RT2_GOLDEN_SHA256,
    'RT4_COMPATIBILITY_DRIFT: RT-4 must not touch the RT-2 golden',
  );
  const raw = await readFile(RT3_GOLDEN_URL, 'utf8');
  const golden = JSON.parse(raw);
  assert.equal(`${JSON.stringify(golden, null, 2)}\n`, raw, 'the RT-3 golden must stay canonically serialized');
  assert.ok(golden.linkedExpressionKinds.includes('user-call'));
  const preSlice = {
    ...golden,
    linkedExpressionKinds: golden.linkedExpressionKinds.filter((kind) => kind !== 'user-call'),
  };
  assert.equal(
    createHash('sha256').update(`${JSON.stringify(preSlice, null, 2)}\n`).digest('hex'),
    RT3_PRE_SLICE_SHA256,
    'RT4_COMPATIBILITY_DRIFT: removing the one added element must reproduce the pre-slice RT-3 golden byte for byte',
  );
});

test('the compatibility fixtures really are call free', async () => {
  for (const name of Object.keys(CALL_FREE_FIXTURES).sort()) {
    const program = await linkedProgram(CALL_FREE_FIXTURES[name]());
    assert.equal(program.helpers, undefined, `${name} must link no helper`);
    assert.ok(
      JSON.stringify(program.program).includes('"kind":"user-call"') === false,
      `${name} must contain no user-call node`,
    );
  }
});
