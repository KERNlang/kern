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
    javascriptArtifactSha256: '7b4395f146e1a647c339bb726bd9eb2559730b7ca9e7657e0234c97f69d98b91',
    javascriptManifestSha256: '91372b6f4785d44473c04b5c4195cbeec9d7f9e1ffcd10b43ee431b0573bf264',
    linkedProgramSha256: '81872ecb59e44fd79b868b297c8bb5660756ee76bd46b16a1ad8ed65bb3a8112',
    pythonArtifactSha256: 'ae97463c40e9cb77c60a27dafce284a62f6e7d0168c4b31b0ef746697f285cab',
    pythonManifestSha256: '5587e4b9ab438bf4cc8173f51ce192458c397810f6fc675af609f1ec3c575f49',
  },
  branch: {
    javascriptArtifactSha256: '3df36a6120758015c304eba49835d624b7a950c3b20645001741865b1c166196',
    javascriptManifestSha256: '767973dd6778f476b23e7a58216f672d8de4e709e02e8c0fea5f3d5cc525ca92',
    linkedProgramSha256: '8741ef79c2d35b0f1be4f3393727d17b25729ad2cb70233b5a93314f799aff7f',
    pythonArtifactSha256: '51c3f35a4f374b18a69a31e1f00fca8f754034e3361438faa7d4cac2d8f4f059',
    pythonManifestSha256: 'b104b486c59d5d77fd2ed0cb7bf108a5a4cb8a6ee90802a4f7f0c9783f6ef00d',
  },
  capability: {
    javascriptArtifactSha256: '7e86200957c72e9d683ea0ecb4732589996f9d7ab09770a65b9775e1ecb6166c',
    javascriptManifestSha256: '615bc13c42c7ce3aeacff422ff1bdebb1c842638ef11ca65005e2bc3f447ba36',
    linkedProgramSha256: 'd2e11a853f6cc21bf7e9895580cec12c821646e4916206a47f343a0bfb3c2b9b',
    pythonArtifactSha256: 'fe7f96eb8adc4d24111504de4131c4417a604c70d7632e1c875a4a27c2e88d61',
    pythonManifestSha256: '88c9003946514f7bd71b533a1e28679d9d400f3f71ddfa2481d5158bce6ebb90',
  },
  literal: {
    javascriptArtifactSha256: '0dc137d1dd13210d5b8cb369c0bc2bfe08396aa43f68fc29cd52baafeca03a04',
    javascriptManifestSha256: '2bde3e6717937f63a512ebc4587e4b23651f605acbf71734807895683d3986a9',
    linkedProgramSha256: 'da5c688ae729e4961f987d63313f9e0c2714b37d668d644c6900860f035e613f',
    pythonArtifactSha256: '4e823ddbd43b646c590606223848bb37219b00a8ea5f1dd8ef08b5df402622c7',
    pythonManifestSha256: 'f2dc5e5d75861afe4ca5f46b06ae750bf893a0d7be4f49dba25c770e23580b55',
  },
  ordering: {
    javascriptArtifactSha256: '744988b7cdcfcff35b0a6ddbf5192d191ebaa9559d0193b5868a05e8109210d1',
    javascriptManifestSha256: '9afb973fddf43c1090c13e06761d14c92eb65a5949ad8738777039cc36050d04',
    linkedProgramSha256: '4f9c0beae2e50a32208cc947aaf43af6840a7adc5bd84efb4f3bb116de949d85',
    pythonArtifactSha256: 'b6feaf3e43fe205d466894b008c4e9107356b100ada2a60c3bf800ce224ffa8e',
    pythonManifestSha256: 'a583dc73cb92fbaa80bbf75cff77484640489806dfe96b6fea1efc2b95931b01',
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
