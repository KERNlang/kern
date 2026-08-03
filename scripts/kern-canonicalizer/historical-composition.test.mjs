import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  loadHistoricalCanonicalizerComposition,
  loadPreM4142CanonicalizerComposition,
  loadPreM4147CanonicalizerComposition,
  loadPreM4151CanonicalizerComposition,
} from './historical-composition.mjs';

const EXPECTED_DIGESTS = {
  canonicalizerCompositeSha256:
    'c68131992b98a4c2a78b9404f537180e1959e88a3116d5513d989ea7a1418f47',
  compositionRecordSha256:
    '11b218a5477fc6c4e7d2b8fd0f9c8c208facd472f300e214c25f83bb5799770c',
  expressionHelpersSha256:
    'bdb40cb0006af0e92b3a4383c7c71a3df7e417fda1569a1860d8f9a65d08ee52',
  mainSourceSha256:
    '23cd17bc4b2869851c294fddfcb9f44bc3174a835e6fc2c6231aa01869f8c195',
  statementHelpersSha256:
    'fd2dc3cddf57509244dfc4210bbcc106727a80422b379cfd21d09ee90e1d67b2',
};

const SOURCE_URLS = [
  new URL(
    '../../examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    import.meta.url,
  ),
  new URL(
    '../../examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
    import.meta.url,
  ),
  new URL('../../examples/kern-canonicalizer/canonicalizer.kern', import.meta.url),
];

test('historical composition reconstructs the exact pre-M4.108 executable inputs', () => {
  const historical = loadHistoricalCanonicalizerComposition({
    expectedDigests: EXPECTED_DIGESTS,
    milestone: 'test',
  });
  assert.deepEqual(historical.digests, EXPECTED_DIGESTS);
  assert.equal(historical.record.composite.bytes, historical.composite.length);
  assert.equal(
    historical.statementHelpers.toString('utf8').includes(
      'fn name=validstatement params="id:number,returnType:string,',
    ),
    true,
  );
});

test('pre-M4.142 composition reverses only the bounded member split and canonicalize signature', () => {
  const historical = loadPreM4142CanonicalizerComposition();
  assert.equal(
    historical.digests.canonicalizerCompositeSha256,
    'd96dee80f12236a3d9089bf44aeee699e6a3c35856e71f79a0743691248ea16e',
  );
  assert.match(
    historical.mainSource.toString('utf8'),
    /fn name=canonicalize params="nodeKind:string\[\],nodeParent:number\[\]/u,
  );
  assert.match(historical.mainSource.toString('utf8'), /fn name=nodetablesok /u);
  assert.doesNotMatch(
    historical.statementHelpers.toString('utf8'),
    /fn name=nodetablesok /u,
  );
});

test('pre-M4.147 composition reverses only the expressionsources signature', () => {
  const historical = loadPreM4147CanonicalizerComposition();
  assert.deepEqual(historical.digests, {
    canonicalizerCompositeSha256:
      '9e7ecb330e665b7bf2a0d7e13d78f4cf3c0b9e5b27a799bdafbabd0e18ca770a',
    compositionRecordSha256:
      '3093e49e5c543d874a30bf501cb364e192d3dcb17fdad010204997b71ea99726',
    expressionHelpersSha256:
      'c32414ee7aa6f29d092dc21de5065f04c4054c54d070dd4d964763047170ee2f',
    mainSourceSha256:
      'a7dab28a69cf8b7b14e4747f586526eabfc87b22bd2eca6e648b89695195f598',
    statementHelpersSha256:
      'bf8d34b94cb5871b6f63bca8a982fd0a592f81cd513290ad7bd2cbaef459e05a',
  });
  assert.match(
    historical.mainSource.toString('utf8'),
    /fn name=expressionsources params="valueTag:string\[\],valueParent:number\[\]/u,
  );
  assert.doesNotMatch(
    historical.mainSource.toString('utf8'),
    /fn name=expressionsources returns="string\[\]" export=true\n  param /u,
  );
});

test('pre-M4.151 composition reverses only the quotesource parameter signature', () => {
  const historical = loadPreM4151CanonicalizerComposition();
  assert.deepEqual(historical.digests, {
    canonicalizerCompositeSha256:
      'd3671c6647993e13cc09e3ebb9ffb18a20009b27761d2d8bb29a2a64d093b8c2',
    compositionRecordSha256:
      '89f0b37cd9ca2e40bfe4fd3998816990720ff6306001c1f93289e3b80bb977a0',
    expressionHelpersSha256:
      '2073ed0c915c0375a43accc202e1c99ceacef84ec1972ef2fc6d25ebcdf7986a',
    mainSourceSha256:
      '59469585c235eec61ea9b695cae3ce2ec94677eb0fdef6a88f41801d8191a0da',
    statementHelpersSha256:
      'bf8d34b94cb5871b6f63bca8a982fd0a592f81cd513290ad7bd2cbaef459e05a',
  });
  assert.match(
    historical.expressionHelpers.toString('utf8'),
    /fn name=quotesource params="value:string,validated:boolean" returns=string export=true/u,
  );
  assert.doesNotMatch(
    historical.expressionHelpers.toString('utf8'),
    /fn name=quotesource returns=string export=true\n  param /u,
  );
});

test('historical composition rejects signature and unrelated source drift', () => {
  const sources = SOURCE_URLS.map((url) => readFileSync(url));
  const mutations = [
    (copy) => {
      copy[1] = Buffer.from(
        copy[1].toString('utf8').replace('param name=id type=number', 'param name=id type=string'),
      );
    },
    (copy) => {
      copy[1] = Buffer.concat([copy[1], Buffer.from('# unrelated drift\n')]);
    },
    (copy) => {
      copy[0] = Buffer.concat([copy[0], Buffer.from('# unrelated drift\n')]);
    },
    (copy) => {
      copy[2] = Buffer.concat([copy[2], Buffer.from('# unrelated drift\n')]);
    },
  ];
  for (const mutate of mutations) {
    const copy = sources.map((source) => Buffer.from(source));
    mutate(copy);
    assert.throws(
      () => loadHistoricalCanonicalizerComposition({
        expectedDigests: EXPECTED_DIGESTS,
        milestone: 'test',
        sources: copy,
      }),
      /(?:test historical composition|test (?:expression|statement) helpers historical source|test main source historical source) rejection:/u,
    );
  }
});
