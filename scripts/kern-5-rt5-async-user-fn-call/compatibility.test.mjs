import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ASYNC_TEXT_HELPER,
  BOOLEAN_FLAG,
  SYNC_TEXT_HELPER,
  TEXT_INPUT,
  compileJavaScript,
  compilePython,
  entryFn,
  linkedProgram,
  moduleSource,
  project,
} from './k0-support.mjs';

const RT2_GOLDEN_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);

const RT2_GOLDEN_SHA256 = 'cc7fb869d3f51ca6222521df52dd70e2364a83c8f97365f8db0a8c83cc2f9908';

const LIST_INPUT = Object.freeze([Object.freeze({ name: 'xs', type: 'boolean[]' })]);

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

const HELPER_BEARING_FIXTURES = Object.freeze({
  'branching-callee': () =>
    moduleSource([
      {
        body: ['if cond="flag"', '  print value="\\"yes\\""', '  return value="false"', 'return value="true"'],
        name: 'negate',
        parameters: BOOLEAN_FLAG,
        returns: 'boolean',
      },
      entryFn(['return value="negate(flag)"']),
    ]),
  'callee-print-into-caller-buffer': () =>
    moduleSource([
      { body: ['print value="t"', 'return value="t"'], name: 'shout', parameters: TEXT_INPUT, returns: 'string' },
      entryFn(['print value="shout(t)"', 'print value="shout(t)"', 'return value="t"'], TEXT_INPUT, 'string'),
    ]),
  'chain-of-three': () =>
    moduleSource([
      { body: ['return value="flag"'], name: 'inner', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      { body: ['return value="inner(flag)"'], name: 'middle', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      { body: ['return value="middle(flag)"'], name: 'outer', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      entryFn(['return value="outer(flag)"']),
    ]),
  'entry-capability-with-call': () =>
    moduleSource([
      { body: ['return value="flag"'], name: 'helper', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      {
        body: [
          'capability namespace=fixture operation=resolve name=reply',
          'let name=checked value="helper(flag)"',
          'if cond="checked"',
          '  return value="reply"',
          'return value="\\"skipped\\""',
        ],
        exported: 'true',
        name: 'route',
        parameters: BOOLEAN_FLAG,
        returns: 'string',
      },
    ]),
  'list-across-the-boundary': () =>
    moduleSource([
      { body: ['return value="xs"'], name: 'pick', parameters: LIST_INPUT, returns: 'boolean[]' },
      entryFn(['return value="pick(pick(xs))"'], LIST_INPUT, 'boolean[]'),
    ]),
  'result-drives-a-binary': () =>
    moduleSource([
      { body: ['return value="flag"'], name: 'helper', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      entryFn(['return value="helper(flag) && (helper(flag) == flag)"']),
    ]),
  'two-argument-callee': () =>
    moduleSource([
      {
        body: ['return value="a && b"'],
        name: 'both',
        parameters: [
          { name: 'a', type: 'boolean' },
          { name: 'b', type: 'boolean' },
        ],
        returns: 'boolean',
      },
      entryFn(['return value="both(flag, flag)"']),
    ]),
});

// Measured on the RT-4 base 5e359bb6, before any RT-5 production file was touched.
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
  'branching-callee': {
    javascriptArtifactSha256: 'c9c810406c5f237ad7eae289f01d78797b2a3fd87f6cdbd1f3637588eeaedb51',
    javascriptManifestSha256: '0abb01f3dedadb32d0e3b66111327f37391d736af5592fb9d3d038e6d9848783',
    linkedProgramSha256: '34f662245dca79c37ef9084c96e749cd691d4c84913c1f1bbcbd7db61f02d56e',
    pythonArtifactSha256: 'e9104d4ba881b2c4c838affbbee3264bcd516922e97162ae15ef0917c6951e82',
    pythonManifestSha256: 'efd019aa1c0c1edf7d23fa29e26050c467904caefb8feb808dddb8df8dfd1418',
  },
  'callee-print-into-caller-buffer': {
    javascriptArtifactSha256: 'c299ddfa1163e3d5e1e5bb51a986539c8397fa396799adfc5ac2f528e9b6d634',
    javascriptManifestSha256: 'f580f7e0f742bfa44439e4ad4cf58a2ac2b714c66cb3a6f58907e4b01def7833',
    linkedProgramSha256: '16d5c05b775dc3f312ff6b345cc04ad2557e75169c74c4fddf942367d1691f78',
    pythonArtifactSha256: '4f0032f88de9cf5ba9cf1b780022f5afe0a5f2fa353f061fdb0aa3a4b4c25e91',
    pythonManifestSha256: '6cdf543de30ddf0f665e07e40eb29e349b1e1d53d5a1ab826bf3f79eafcb5765',
  },
  capability: {
    javascriptArtifactSha256: '231e8354c27f7479f435123aa342e69ff83d3f6bdff702b640f1e62ef6eb60dd',
    javascriptManifestSha256: '4393ec41fb5cbba588b7c6016864a9f6b7252a16816460ac196160975d39b8a4',
    linkedProgramSha256: 'd2e11a853f6cc21bf7e9895580cec12c821646e4916206a47f343a0bfb3c2b9b',
    pythonArtifactSha256: '737c3141e0e8c38f54b2d30f5875c61a187c7cd0360eec5c146a3995f6b58d55',
    pythonManifestSha256: '7c4997da581dfccd04472681895bb8641eed480bc3cdb0da3d1c83f3ca0c8f9e',
  },
  'chain-of-three': {
    javascriptArtifactSha256: 'acd60551ca75f251c0d41593a7032d9a37e57ac58882f8e195df333f6f19be27',
    javascriptManifestSha256: '7a469e4a7492710232f428b0fb40b093379c6720a7974be4d80c1387eb663b3e',
    linkedProgramSha256: 'cf225e07ecc6023527c3950b512a16aca87b493a562feb1e825e2a84a714fa24',
    pythonArtifactSha256: '84c998c556f6a32b77ae158c3673ebcaf30a0bff4f7f535324c985ee2d5af9c0',
    pythonManifestSha256: 'eb9add99d40c5009bfd8fcd2367391503cd796b12abed4dce3a58254c2d96da0',
  },
  'entry-capability-with-call': {
    javascriptArtifactSha256: 'e0916066668d3e7d911e3b99f58104399d6de8c72a3ddbaa4355d0d8b9dfccb1',
    javascriptManifestSha256: 'b2de2eb4e4e80bf5786a0ee6adaa04a2f482c72ba8b646ba695bff860e5e75e5',
    linkedProgramSha256: '672fb5399886fb630c04ec2f21cda291a805992cd5707608b69d6decc951ede0',
    pythonArtifactSha256: '7710bd085af2744fe6bbb68b6dfdfccf3494d8ba0bf77fb5340bba20fbff046d',
    pythonManifestSha256: '6bbfc0705063545d339f61615b841dff084281352543fe5bff1e65e8423a9f18',
  },
  'list-across-the-boundary': {
    javascriptArtifactSha256: '3f2668d3c1aaa698d67add0c61d72b43f02dfe76a3c7b5f8be25439333540f84',
    javascriptManifestSha256: '34a771caf2f58f35fd71c60276072f928b53e3a3e7b41c894810c3c8988aefba',
    linkedProgramSha256: 'd5d6906e338917f705fcc1fe51796311c6c66194576fd83a7b7be1eeeddd92c4',
    pythonArtifactSha256: '56f891f9c70260d9bb27e50be59d902471a358f80614f18e94ba6df7b9a85eee',
    pythonManifestSha256: '30fda46b7a10c80d2e4dba1c36d021b6aa2860ba472e11cdabb734a84f1036a6',
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
  'result-drives-a-binary': {
    javascriptArtifactSha256: 'a53a2c89cd7f38a069b643c7638c877ec815ed27dba2affdd6ee9ce609f14713',
    javascriptManifestSha256: '3571979af94855db45cfdba1cf8c9a637674e933373ace138b7211fd117152db',
    linkedProgramSha256: '9ced58268138f7aff00f05236edf588f8e3515e7cb182d32e7f1e362e19ce194',
    pythonArtifactSha256: 'a0423f863470e11b4d42f4124a62b90dea7d79408faffe55df80090eae97081e',
    pythonManifestSha256: '4e1129181727eaf43bf2d52228e85890a9f8798221a4a1635702b39c57afca2e',
  },
  'two-argument-callee': {
    javascriptArtifactSha256: 'eebb6351256a536fb3c279e17846d46e84457c99bbb27629934c51fa1fb2b7c2',
    javascriptManifestSha256: '77e621091ad9e96c2c0b7445ff710cfc2def085ab24a0f4407a7efd49523c23e',
    linkedProgramSha256: '0590e68d9a614127db8b62e21cbc412d406b5c1e9b8d683948075122527dc077',
    pythonArtifactSha256: 'bf78fdf18fe53d31159ccbb9a77f2026a709806ae98a6e6e946c1b3a9c366470',
    pythonManifestSha256: '7c8770fd62e5c8138e0af88e41e271742bdd142aa7f803b9e9000fdbdc6396b9',
  },
});

const ALL_FIXTURES = Object.freeze({ ...CALL_FREE_FIXTURES, ...HELPER_BEARING_FIXTURES });

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

test('every RT-4 digest, call free and helper bearing, is byte-identical to the pre-slice build', async () => {
  assert.deepEqual(
    Object.keys(PRE_SLICE_DIGESTS).sort(),
    Object.keys(ALL_FIXTURES).sort(),
    'every pinned digest must have a live fixture behind it',
  );
  for (const name of Object.keys(ALL_FIXTURES).sort()) {
    assert.deepEqual(
      await digests(ALL_FIXTURES[name]()),
      PRE_SLICE_DIGESTS[name],
      `RT5_COMPATIBILITY_DRIFT: ${name} changed the linked encoding or an emitted artifact`,
    );
  }
});

test('every RT-4 helper-bearing fixture is entirely synchronous, so the flag is what keeps its bytes', async () => {
  for (const name of Object.keys(HELPER_BEARING_FIXTURES).sort()) {
    const program = await linkedProgram(HELPER_BEARING_FIXTURES[name]());
    assert.ok(program.helpers.length > 0, `${name} must actually link a helper`);
    for (const helper of program.helpers) {
      assert.equal(
        Object.hasOwn(helper, 'async'),
        false,
        `RT5_ASYNC_FLAG_SERIALIZED_WHEN_FALSE: ${name}.${helper.name} must carry no async key`,
      );
    }
  }
});

test('a call-free program still carries no helpers field at all', async () => {
  for (const name of Object.keys(CALL_FREE_FIXTURES).sort()) {
    const program = await linkedProgram(CALL_FREE_FIXTURES[name]());
    assert.equal(program.helpers, undefined, `${name} must not serialize an empty helpers field`);
  }
});

test('an async helper does change the digest, so the compatibility oracle is not vacuous', async () => {
  const syncOnly = await linkedProgram(
    moduleSource([SYNC_TEXT_HELPER, entryFn(['return value="echo(t)"'], TEXT_INPUT, 'string')]),
  );
  const withAsync = await linkedProgram(
    moduleSource([ASYNC_TEXT_HELPER, entryFn(['return value="fetchIt(t)"'], TEXT_INPUT, 'string')]),
  );
  assert.notEqual(syncOnly.sha256, withAsync.sha256, 'the flag has to be observable somewhere');
  assert.equal(withAsync.helpers[0].async, true);
});

test('the RT-2 and RT-3 K0 goldens are untouched, and RT-5 adds no linked expression kind', async () => {
  const rt2 = await readFile(RT2_GOLDEN_URL);
  assert.equal(
    createHash('sha256').update(rt2).digest('hex'),
    RT2_GOLDEN_SHA256,
    'RT5_COMPATIBILITY_DRIFT: RT-5 must not touch the RT-2 golden',
  );
  const golden = JSON.parse(await readFile(RT3_GOLDEN_URL, 'utf8'));
  assert.deepEqual(
    golden.linkedExpressionKinds,
    ['binary', 'identifier', 'json-call', 'list', 'literal', 'member', 'record', 'unary', 'user-call'],
    'RT-5 introduces no expression variant, so the RT-3 inventory must not move',
  );
});
