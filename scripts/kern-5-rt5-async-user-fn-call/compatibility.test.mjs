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
    javascriptArtifactSha256: '7b4395f146e1a647c339bb726bd9eb2559730b7ca9e7657e0234c97f69d98b91',
    javascriptManifestSha256: '91372b6f4785d44473c04b5c4195cbeec9d7f9e1ffcd10b43ee431b0573bf264',
    linkedProgramSha256: '81872ecb59e44fd79b868b297c8bb5660756ee76bd46b16a1ad8ed65bb3a8112',
    pythonArtifactSha256: '0e6428453eecebb17f7e91d5622359ae28776d02a6a552da4bc82d274f75e294',
    pythonManifestSha256: 'ec1bc18c887008403b38c903db4d5d77bce3ea7da80134dc7ae24cd9c74bba88',
  },
  branch: {
    javascriptArtifactSha256: '3df36a6120758015c304eba49835d624b7a950c3b20645001741865b1c166196',
    javascriptManifestSha256: '767973dd6778f476b23e7a58216f672d8de4e709e02e8c0fea5f3d5cc525ca92',
    linkedProgramSha256: '8741ef79c2d35b0f1be4f3393727d17b25729ad2cb70233b5a93314f799aff7f',
    pythonArtifactSha256: '1798f75efe3cdc3f3a1e3427fb15f213a91fafbd0b185322635f465bd9944681',
    pythonManifestSha256: '5ee08615d6369a71174a45dedbc8ee6b064d14029976e151e966f4ed8f70270c',
  },
  'branching-callee': {
    javascriptArtifactSha256: '0b3ca202420cdd1fd7c76c9bd9452bb6ed94bcf0ac4895e2a0b8e23e973542a9',
    javascriptManifestSha256: '25c8099e8562a0952508f5889434af00b0d82824812c222defee18a28b0089f7',
    linkedProgramSha256: '34f662245dca79c37ef9084c96e749cd691d4c84913c1f1bbcbd7db61f02d56e',
    pythonArtifactSha256: 'd485e5f0ad3c0a6276551b8ea2a2d720c1c075777fc107f37cd478b5b0edd061',
    pythonManifestSha256: '47773962c0180f95e64169c7f552495fc547d138d79b41e58d1e5506a70972a6',
  },
  'callee-print-into-caller-buffer': {
    javascriptArtifactSha256: '2aa271d78d8603dd789160dbd733b96f3a76b99cca224840c162d57cfca041f7',
    javascriptManifestSha256: '3b15b00351df8e6122f5a12db9b6bb792173a090139c8b4f281d69e503553b25',
    linkedProgramSha256: '16d5c05b775dc3f312ff6b345cc04ad2557e75169c74c4fddf942367d1691f78',
    pythonArtifactSha256: '99406696baf15f8d4be4eaa0aca3eb1cdb96f276ea200ba6af057454a4b0d163',
    pythonManifestSha256: 'f667fd56ce689e1e4ae00c65c245f0fc52bedb94cf43149b49fed56fd28e66fc',
  },
  capability: {
    javascriptArtifactSha256: '7e86200957c72e9d683ea0ecb4732589996f9d7ab09770a65b9775e1ecb6166c',
    javascriptManifestSha256: '615bc13c42c7ce3aeacff422ff1bdebb1c842638ef11ca65005e2bc3f447ba36',
    linkedProgramSha256: 'd2e11a853f6cc21bf7e9895580cec12c821646e4916206a47f343a0bfb3c2b9b',
    pythonArtifactSha256: 'c84c3a40e0f1b6b0fff63554a2a7d68813fb24c75e63408cdf6edac0c493f1e9',
    pythonManifestSha256: '8104e26aa9ceeadf0a0ec9e82947012d31a9ffde59340bfe04320f9849157a3c',
  },
  'chain-of-three': {
    javascriptArtifactSha256: 'f2fbfbb7c8c165168067c3a12587ccf4aa67e03a361f9a221913da35a21464e9',
    javascriptManifestSha256: '85d2d67156e44626287f95b1951073270137f7b4ff83fcbc83c3513f5b8ee067',
    linkedProgramSha256: 'cf225e07ecc6023527c3950b512a16aca87b493a562feb1e825e2a84a714fa24',
    pythonArtifactSha256: 'e384a1a4cf335459cf43c81863d0ffe007fb2456ba0a5f3aa17730a087a0b753',
    pythonManifestSha256: '4e44f8ee06b6b4d9c475846c92ac26935f965ded3d74591344941e5c99cd1f6a',
  },
  'entry-capability-with-call': {
    javascriptArtifactSha256: '8128bcbfde382953cf5b2814798b79978733e9dc06269d69309810413ad0a360',
    javascriptManifestSha256: '07c79d1671c9f58d645cce50f6fba011b044307b26cec8cfdb4fa50c2598e8a7',
    linkedProgramSha256: '672fb5399886fb630c04ec2f21cda291a805992cd5707608b69d6decc951ede0',
    pythonArtifactSha256: '0c61fdee5736857333d70c140080bdd488f6b88cda7a49f240e21cff6986a2e0',
    pythonManifestSha256: 'cb094b7436153d84074a2b29538764c7705f737b51c333a30915ad6e42c164b6',
  },
  'list-across-the-boundary': {
    javascriptArtifactSha256: '0147ba4710a8451bcaf41e72282374c89c1aa9f88897769b7f8d67f2c98f556c',
    javascriptManifestSha256: 'c587ba847745970bc7273b0f9e76d38a7ae750c31e437d499c7e43545079785c',
    linkedProgramSha256: 'd5d6906e338917f705fcc1fe51796311c6c66194576fd83a7b7be1eeeddd92c4',
    pythonArtifactSha256: 'efec3d85bea2e69e48ba06d55ea4ba4d19fa5daa224cda43cbcd2cbc844fecd9',
    pythonManifestSha256: '22ce7306a2e63b7805f0a93276d860384096393348d1fd48239910826f4ab288',
  },
  literal: {
    javascriptArtifactSha256: '0dc137d1dd13210d5b8cb369c0bc2bfe08396aa43f68fc29cd52baafeca03a04',
    javascriptManifestSha256: '2bde3e6717937f63a512ebc4587e4b23651f605acbf71734807895683d3986a9',
    linkedProgramSha256: 'da5c688ae729e4961f987d63313f9e0c2714b37d668d644c6900860f035e613f',
    pythonArtifactSha256: 'e8e2a1c048dc2addc18b7b2bc2e3a0d787c33add8bb02338e11149bbd8209bfe',
    pythonManifestSha256: 'c3d556028f3facb8042eddcff2d7e9c0e488647e4bb792d151374b1428899a5a',
  },
  ordering: {
    javascriptArtifactSha256: '744988b7cdcfcff35b0a6ddbf5192d191ebaa9559d0193b5868a05e8109210d1',
    javascriptManifestSha256: '9afb973fddf43c1090c13e06761d14c92eb65a5949ad8738777039cc36050d04',
    linkedProgramSha256: '4f9c0beae2e50a32208cc947aaf43af6840a7adc5bd84efb4f3bb116de949d85',
    pythonArtifactSha256: 'd858a8dbd948ea1458dac3977d84c2cf86b53fa16ddba7d6d2abb1c28e73296a',
    pythonManifestSha256: '8573b144077ab8716df8a85f51e2fe5e3045c77667eec9a769b7fce8b4c6ce39',
  },
  'result-drives-a-binary': {
    javascriptArtifactSha256: '031b3429ec5d521ea22a4bc3f367564af2baae0c046767f82112148f3340c306',
    javascriptManifestSha256: '65e1dda2cfd29969bc9ef9eea965ba22e20ae724286031fd5c53db99f84f705c',
    linkedProgramSha256: '9ced58268138f7aff00f05236edf588f8e3515e7cb182d32e7f1e362e19ce194',
    pythonArtifactSha256: '8c90860a162d6cda487624f5d55e90b66690bef8af0e62c303047dd6e2222401',
    pythonManifestSha256: '39ad73e86f64c07c6af1165b1c6e896e4d0cca5bdde0fd13cd37fff0df592dd6',
  },
  'two-argument-callee': {
    javascriptArtifactSha256: 'c20a5cc547de46fe17b642fffa1604fe96e838ea320f6a1262e9d3ead884ddd5',
    javascriptManifestSha256: 'acf301cf474a161eeea9f9e9edc5db63087208074d2d2bbb9509cd2c718956bd',
    linkedProgramSha256: '0590e68d9a614127db8b62e21cbc412d406b5c1e9b8d683948075122527dc077',
    pythonArtifactSha256: 'b1c6b2bf3ef32583c2e1494a594fab7e0e3f8567bfa73b322ce5f9556ecad7c6',
    pythonManifestSha256: 'f1e343a559211cc8b4c2083c9508c2e56e109de84bf5ad7da22e86d48bfdc3b0',
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
