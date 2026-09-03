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
    javascriptArtifactSha256: 'c17c9a01abc29b532ba30d15465e80e463d5b7d96ef3bc37b429a189cb3ec5bf',
    javascriptManifestSha256: '6143c5f7f93574194dbe0e59a87a2133cc6036c42426c5077705f87680feeee0',
    linkedProgramSha256: '81872ecb59e44fd79b868b297c8bb5660756ee76bd46b16a1ad8ed65bb3a8112',
    pythonArtifactSha256: '3dfea7d54764023dc23843af57c8fbba57cd32feb4c3cd519481ab21b697f555',
    pythonManifestSha256: '6fa16cab33eb4006faf4bbb099d4ec877e2f8fc3317277926c8c0110bedc1bb3',
  },
  branch: {
    javascriptArtifactSha256: '65f0583785f6a238ca1f310e51db4e915b35db479cc29154331b6ef007541beb',
    javascriptManifestSha256: '3c2b1201c16c33e9bed859cd3cf2a0546521a3f83c3950e6ea51bc33c597b1d4',
    linkedProgramSha256: '8741ef79c2d35b0f1be4f3393727d17b25729ad2cb70233b5a93314f799aff7f',
    pythonArtifactSha256: 'fa68566c54c7eeb64e9ed3276bb0a7445ea096159bcd8214a13797ec014f80d7',
    pythonManifestSha256: 'a775056cb39a734bc85484aa2e3221e00d9e14e221cad6d7055989613160aa28',
  },
  'branching-callee': {
    javascriptArtifactSha256: '4ee53f796259102f69e5ad26bec3eacbcdda284345927375e78421f0e5b69db2',
    javascriptManifestSha256: 'ecde5875ae82c7a08483cfd3b21bf862a4e108886ff51243aa9ab2c63f65626a',
    linkedProgramSha256: '34f662245dca79c37ef9084c96e749cd691d4c84913c1f1bbcbd7db61f02d56e',
    pythonArtifactSha256: 'a0a46e26b9633c714d2f8074787a7e62655052332d95b806329d4d0c8ad23725',
    pythonManifestSha256: 'f37d1a3f041783df0534e682507c39689cbeec2fb8fc03b4e6f4c8d5fc3883aa',
  },
  'callee-print-into-caller-buffer': {
    javascriptArtifactSha256: '7cf6a08a1fd8882010eb9d20851254de064ba5b42da512b29f4d14dee10d9aad',
    javascriptManifestSha256: '92ae3659539af8f7fb45ea5c91afeb9fb3111fba6fe49312718748f4769498e5',
    linkedProgramSha256: '16d5c05b775dc3f312ff6b345cc04ad2557e75169c74c4fddf942367d1691f78',
    pythonArtifactSha256: 'cb748470d4acab6676e34a3d0cea8837b3d13287f6dd4d295ed0c2f91b2ea6be',
    pythonManifestSha256: 'af1756a3406fb5158aa37b9b44bb14d852db62239689885c3d80c38daa89b9bf',
  },
  capability: {
    javascriptArtifactSha256: '2f839349604c02ca30979eb1360a189e75ac2a88f9db08310e09cfdd66c4a40c',
    javascriptManifestSha256: 'ad7780586e94f235d0daf7b0aa7c9f2c168a14321d6f78fefbf2bcc9e8770810',
    linkedProgramSha256: 'd2e11a853f6cc21bf7e9895580cec12c821646e4916206a47f343a0bfb3c2b9b',
    pythonArtifactSha256: '0ef1e7401ccfc0c706e63aa1c9020c55026d5c6e3eb942eaa174666ab4e6bb5f',
    pythonManifestSha256: '41b14f6f2b655bfc6444d91b59ee89c3ed2796c5d3c38aaa3b2f2c0046635a0a',
  },
  'chain-of-three': {
    javascriptArtifactSha256: '7d0fd14f0813934d0953370d1ff0c2355235533d3aba5cedddd1ef17b1b44e9c',
    javascriptManifestSha256: '6a6a7d37cecc4e579f436e836a4718daba7d425a47b6270163362fd5b5b1ea70',
    linkedProgramSha256: 'cf225e07ecc6023527c3950b512a16aca87b493a562feb1e825e2a84a714fa24',
    pythonArtifactSha256: '40aaeddffe4b2f8374738757adfd4b9caccfc0afa661e462f3edbfe640213ad4',
    pythonManifestSha256: '006d338533af2398883fc5740d41bf3b5f384fa8bf766740254100621484c177',
  },
  'entry-capability-with-call': {
    javascriptArtifactSha256: '65a3840996575049b6c3e5e6011c972971a4830a025fb40d5efdc2d2d7635dcc',
    javascriptManifestSha256: '5e7ee9406134b0cec3440c8503713e81220e367525b6a058ff6880d0d749fb71',
    linkedProgramSha256: '672fb5399886fb630c04ec2f21cda291a805992cd5707608b69d6decc951ede0',
    pythonArtifactSha256: '83300f83f10f797122ef7986601d44768918fac8a16ce736714642f1cfb8543b',
    pythonManifestSha256: '75d9bc43bb15ea0815f59b44c1f402938448cc0e70bb5b68d58ff55f2844cb2d',
  },
  'list-across-the-boundary': {
    javascriptArtifactSha256: '46c10f0cfa7acb08af0e78576048b5451f1a2e3e3622aa13d56cf4a74d52e876',
    javascriptManifestSha256: 'ce9323ab9171498e54e0c7d93b1e4c7a8dae4756a69495858f9b3f2569482985',
    linkedProgramSha256: 'd5d6906e338917f705fcc1fe51796311c6c66194576fd83a7b7be1eeeddd92c4',
    pythonArtifactSha256: '4c73ed5a91c8e9133a7bd742b5b7c58fd814999ac1a5f69fde56eeacc3197e50',
    pythonManifestSha256: 'f79904b2bc8481836907cc397c3196b52c577de752c2f7220f0e9bdae1a5953a',
  },
  literal: {
    javascriptArtifactSha256: '330f4f911ba83b930a3d4ae32666cedc929dbb209834ff654a2e4c18bf1786dd',
    javascriptManifestSha256: 'ed98f00030ed74c94e39f0b783144c0a4d0cbb7ab9807c0d92dd06cba41360f7',
    linkedProgramSha256: 'da5c688ae729e4961f987d63313f9e0c2714b37d668d644c6900860f035e613f',
    pythonArtifactSha256: '58f612aaff760b65eb2e6671f907c05914cb2a4776580ef046ba5de48c609489',
    pythonManifestSha256: 'c9e4028c2159f5812496fffdae9152adafd574df881723f9ab70b44c44ac4c8f',
  },
  ordering: {
    javascriptArtifactSha256: 'b16455c53382cea4e63cf88d9bece877268c841e3797e31e076f7e324dace8b4',
    javascriptManifestSha256: '34bbe9882f7d5522344599599cb656fdcfcf7d5507db413687b995bc8fa20433',
    linkedProgramSha256: '4f9c0beae2e50a32208cc947aaf43af6840a7adc5bd84efb4f3bb116de949d85',
    pythonArtifactSha256: '4b31b0c552f292de510d06e881f4aeb7b66b20a055cb1ac2d394eba754c3085e',
    pythonManifestSha256: '6a4cec4b41ebe811408ff4ebe6b5f30dbfbc4480023a86d3e54a46e8c2927040',
  },
  'result-drives-a-binary': {
    javascriptArtifactSha256: 'cdd6782262ebdd0e1a7033a33518a1748e496b1d11cee02b4cc64c391f28a027',
    javascriptManifestSha256: '47b86311348a673c5e3c2c055e2c17be46c0ad1bca20bb7c9dd6c5dfeea7c0e5',
    linkedProgramSha256: '9ced58268138f7aff00f05236edf588f8e3515e7cb182d32e7f1e362e19ce194',
    pythonArtifactSha256: 'b9d1deba589313e0fa00405b54df02ea7ea52642bd897885f0e18861fa2d39de',
    pythonManifestSha256: 'af332192bab31e408fed72345fb2c56c2cf5fcfd7529db26ea54cd4d2a0c2a14',
  },
  'two-argument-callee': {
    javascriptArtifactSha256: 'd463ee0760d9c31e296a34e5ae509cc02dfa110bad79f57345b19cf21fe413a5',
    javascriptManifestSha256: '8f7be4e93467d1d0ca6a018bc2619eabc02f8c129212c862917fa2c972354d19',
    linkedProgramSha256: '0590e68d9a614127db8b62e21cbc412d406b5c1e9b8d683948075122527dc077',
    pythonArtifactSha256: '23e73f978dcef91ead5b73e6bffa09faec04ab63eeff313d82fb55bcc36555c4',
    pythonManifestSha256: '4cbb3ecde16798b7a315ce4ac0db60f6f1f90710996ef099f681c22ee4480b0c',
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
