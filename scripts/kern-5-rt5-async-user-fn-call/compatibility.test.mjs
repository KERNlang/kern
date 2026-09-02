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
  'branching-callee': {
    javascriptArtifactSha256: 'fd0c54b2e6dc32952be53ac378c07299ce55badd69772264395f70d8f946a67e',
    javascriptManifestSha256: 'd6a1524226369ca9816bc3b59a460e90ed52259b0f71d1f59973dfba815e573d',
    linkedProgramSha256: '34f662245dca79c37ef9084c96e749cd691d4c84913c1f1bbcbd7db61f02d56e',
    pythonArtifactSha256: '187d719396c753b1af8308cc76b61d1f2f86e34229798cf8bf8503aec957bd26',
    pythonManifestSha256: '49a1485c9556262c584ca336281dd19d634949602610cb5cdcfb9756a6fe09ba',
  },
  'callee-print-into-caller-buffer': {
    javascriptArtifactSha256: '68b8414825579c301d76f963328ab513fe4930d58583eacc01eb6abb6181341c',
    javascriptManifestSha256: 'cbd24a17754b2ce9b8abe68fcd68926650851be5d97b92ce3f68e20eaf846c42',
    linkedProgramSha256: '16d5c05b775dc3f312ff6b345cc04ad2557e75169c74c4fddf942367d1691f78',
    pythonArtifactSha256: '352357440b21a33de202a90fca74297a359e11fa5f6f1314d82915d20f888107',
    pythonManifestSha256: '5e05546a3814b69454a8e9427d655b795576d2aa3c1636209b5dd3db91c58986',
  },
  capability: {
    javascriptArtifactSha256: '546b52eb356d298795dfeda289d67c28fe1014e122a58bec813fb51a76c7e57c',
    javascriptManifestSha256: 'c1a8c79341e85488fdbf07237fa7140d2c5d25637a905557eaa369f402cc982e',
    linkedProgramSha256: 'd2e11a853f6cc21bf7e9895580cec12c821646e4916206a47f343a0bfb3c2b9b',
    pythonArtifactSha256: '5ba7f970142931fb74fcbcd3951940ae39365d9fdb5638c6d6ce92db687fc1a4',
    pythonManifestSha256: '61d23e017aeb965f05328c44eea18f5b25039c6d34cea810be96b0f8c55eb6b1',
  },
  'chain-of-three': {
    javascriptArtifactSha256: 'e004ec18065f8640edf1c29a560abfc1ac3c9a28e081d15c5d83eb0be7c1cd67',
    javascriptManifestSha256: 'f01cc47f6d38ec46edff3efbf1d9efb4571281bcb0be58b24b93f30cce3ee3e7',
    linkedProgramSha256: 'cf225e07ecc6023527c3950b512a16aca87b493a562feb1e825e2a84a714fa24',
    pythonArtifactSha256: '87add984831261dafd2a5349d5d4a5abb54ff326194fa0425b4d1bdb0d04dc09',
    pythonManifestSha256: '62a8f35c0da6e69152e720e0bf0cc3c5333b48553c5c637e4a29037aa52ba9f5',
  },
  'entry-capability-with-call': {
    javascriptArtifactSha256: 'dc22d4983140d71dfcfff40d74c73856815f4457184aa05e5088ea89df610919',
    javascriptManifestSha256: '050813e81cbc5dac1d0120c5aed81e9099efbcbe3149b52a10f4b8a5e52318b0',
    linkedProgramSha256: '672fb5399886fb630c04ec2f21cda291a805992cd5707608b69d6decc951ede0',
    pythonArtifactSha256: 'a1f8c3d2ce23782bfcdf62dcc7d435c2e3dd30b830007a53461cd582e8fe4bfc',
    pythonManifestSha256: '4d455d1d8be2d2719b8511492e4218f374e24d7e552477832ad01ac0924b9d62',
  },
  'list-across-the-boundary': {
    javascriptArtifactSha256: 'd0019c49202d8e4a3fb5ac7017e24fa97e851e1f7e0afccc030b427be3cf9acd',
    javascriptManifestSha256: '3f6b4fd203d86eedf02d2c2087ae3d6d15f8f035a9cf669f17e00f23ea85de36',
    linkedProgramSha256: 'd5d6906e338917f705fcc1fe51796311c6c66194576fd83a7b7be1eeeddd92c4',
    pythonArtifactSha256: 'ae41966e4d9c5c692cd920e387993605031824fd7becf9741f0a895d39743fdb',
    pythonManifestSha256: '2b94096be4397bf89bf9464151f2d0eadbdefe3e5b1c2db1eea8ef111287b350',
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
  'result-drives-a-binary': {
    javascriptArtifactSha256: 'e5aaa0642bd05723b8c236f3d43f708c7387402c9de4cb2b2a9d1edbd8c5de47',
    javascriptManifestSha256: 'd02c0c1e64a5a8a516f0c28e38629b7d3fe668fbba446edae02b917b1a94032f',
    linkedProgramSha256: '9ced58268138f7aff00f05236edf588f8e3515e7cb182d32e7f1e362e19ce194',
    pythonArtifactSha256: '9fff4cf43b450c77c58cd26fc7e443c863a08a1e6c5bfc27e7ef08a1683f5a56',
    pythonManifestSha256: '4f978aaf7539cf7cc971db8285fefb5a13dcd20ba5c42f83b7d887d61f3fb8ce',
  },
  'two-argument-callee': {
    javascriptArtifactSha256: 'ce5240afcbc2438695984d3baf61fd1f19217242ff22e0f62abce6ca423466c1',
    javascriptManifestSha256: '69a9e404d8cbe6b9ae72b7d3d5ee0c2410e5acc6fffeb2b4a5913ec1a544680d',
    linkedProgramSha256: '0590e68d9a614127db8b62e21cbc412d406b5c1e9b8d683948075122527dc077',
    pythonArtifactSha256: '4371848c6ca013a1e57c87910439c804f63206a2b890be0db0860a306f87001d',
    pythonManifestSha256: '1e901fe630dd6646ea2598b8a5027d8540a428487bfc037045320657bf8e7f96',
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
