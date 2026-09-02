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
    javascriptArtifactSha256: '7983d6cf17d68e3be1dc79da0b274c4e592309e3c30e7623620a6df16aa7ef81',
    javascriptManifestSha256: 'b9e768bff0eeec49538274bebaf44568494ab9e7a603b9fd9f744605016c48e0',
    linkedProgramSha256: '81872ecb59e44fd79b868b297c8bb5660756ee76bd46b16a1ad8ed65bb3a8112',
    pythonArtifactSha256: '3bc4a82b0103a732869ea5922ad59f60598396d0f6ff7dd3e3612db64858e58d',
    pythonManifestSha256: 'fbb1ca4cc949a5611591766a0a73bc65b640804bf889199eee7ae1f2a454d96a',
  },
  branch: {
    javascriptArtifactSha256: '89f1f4aa86cbc03400a94665cbcd5876e090fec66ed6d66456602c8dd18a5533',
    javascriptManifestSha256: 'de32bb1ae3c3903a9323b8dae5226bb249bc27023dbc087bf8cf7954b50da7de',
    linkedProgramSha256: '8741ef79c2d35b0f1be4f3393727d17b25729ad2cb70233b5a93314f799aff7f',
    pythonArtifactSha256: 'cc2b2424b5e99780c28bce10f81b3779d26640a80cc1fc269351f2f2dbfc049b',
    pythonManifestSha256: '2214483d852790fd3dc686cbc1d1fa5447fb7c1da420f642ecbc675e4796451b',
  },
  capability: {
    javascriptArtifactSha256: '231e8354c27f7479f435123aa342e69ff83d3f6bdff702b640f1e62ef6eb60dd',
    javascriptManifestSha256: '4393ec41fb5cbba588b7c6016864a9f6b7252a16816460ac196160975d39b8a4',
    linkedProgramSha256: 'd2e11a853f6cc21bf7e9895580cec12c821646e4916206a47f343a0bfb3c2b9b',
    pythonArtifactSha256: '737c3141e0e8c38f54b2d30f5875c61a187c7cd0360eec5c146a3995f6b58d55',
    pythonManifestSha256: '7c4997da581dfccd04472681895bb8641eed480bc3cdb0da3d1c83f3ca0c8f9e',
  },
  literal: {
    javascriptArtifactSha256: 'b45cdc35da00ef81a31b3fd253caa08a5c6e8a520c4058cb63af6561d7dcf220',
    javascriptManifestSha256: 'cc56b27f35be4937b9b149c518a944a870948cfa5d6396ae25418f4f04f1a1c5',
    linkedProgramSha256: 'da5c688ae729e4961f987d63313f9e0c2714b37d668d644c6900860f035e613f',
    pythonArtifactSha256: '944d2fdf756dca628dd6ec6a26e7152a990c20db0ddc41dcb7fcc30250a3906c',
    pythonManifestSha256: '87f446a9ef52c443d1c263128abc1a401df988b3d789a7e06e868b43f9a74b72',
  },
  ordering: {
    javascriptArtifactSha256: 'e508138f80f1d33998ca34296469fb07e9cfaeda0f18dc10651ad5684023b00f',
    javascriptManifestSha256: '99357d49791933f78a6762005a649412e044081f980043bfa571eb79d583b328',
    linkedProgramSha256: '4f9c0beae2e50a32208cc947aaf43af6840a7adc5bd84efb4f3bb116de949d85',
    pythonArtifactSha256: '897230a8b30a8fee17602b883184ed35680fa7290aeb4d14273aca1cf6917bd3',
    pythonManifestSha256: '87241d3e751ae816b0e46cbc45df0bed277c58c4e7b9e7f32aa104baf86f5fe0',
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
