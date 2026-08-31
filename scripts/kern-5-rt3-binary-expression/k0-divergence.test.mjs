import assert from 'node:assert/strict';
import test from 'node:test';

import { boolArgs, envelopeBytes, handlerSource, runtimeRequest, threeLegs } from './k0-support.mjs';

const FLAGS = Object.freeze([
  { name: 'flag', type: 'boolean' },
  { name: 'other', type: 'boolean' },
]);

const FIXTURES = Object.freeze([
  {
    args: { flag: true, other: false },
    name: 'binary condition selects the else block',
    source: handlerSource('string', FLAGS, [
      'if cond="flag && other"',
      '  print value="\"then\""',
      'else',
      '  print value="\"else\""',
      'return value="\"done\""',
    ]),
  },
  {
    args: { flag: false, other: true },
    name: 'binary condition nested inside an else block',
    source: handlerSource('string', FLAGS, [
      'if cond="flag"',
      '  print value="\"outer\""',
      'else',
      '  if cond="other || flag"',
      '    print value="\"inner\""',
      'return value="\"done\""',
    ]),
  },
  {
    args: { flag: true, other: true },
    name: 'binary result encoded through the Json intrinsic',
    source: handlerSource('string', FLAGS, [
      'let name=both value="flag && other"',
      'let name=encoded value="Json.stringify({ both: both, ordered: 1 < 2 })"',
      'print value="encoded"',
      'return value="encoded"',
    ]),
  },
  {
    args: { flag: true, other: true },
    name: 'binary guards a capability call and its committed event',
    source: handlerSource('string', FLAGS, [
      'if cond="flag == other"',
      '  capability namespace=fixture operation=resolve name=reply',
      '  return value="reply"',
      'return value="\"skipped\""',
    ]),
  },
  {
    args: { flag: false, other: false },
    name: 'binary of let-bound binaries',
    source: handlerSource('boolean', FLAGS, [
      'let name=left value="flag || other"',
      'let name=right value="1 >= 2"',
      'return value="left == right"',
    ]),
  },
  {
    args: { flag: true, other: false },
    name: 'binary in an early return before an unreachable statement',
    source: handlerSource('boolean', FLAGS, [
      'if cond="flag != other"',
      '  return value="1 <= 1"',
      'print value="\"after\""',
      'return value="2 > 3"',
    ]),
  },
]);

for (const fixture of FIXTURES) {
  test(`K0 three-leg binary divergence: ${fixture.name}`, async () => {
    const requestId = `rt3-k0-${fixture.name.replaceAll(' ', '-')}`;
    const legs = await threeLegs(fixture.source, runtimeRequest(requestId, boolArgs(fixture.args)));
    assert.equal(legs.direct.envelope.outcome, 'success', 'the K0 fixtures must execute successfully');
    const direct = envelopeBytes(legs.direct.envelope);
    assert.deepEqual(
      Buffer.from(envelopeBytes(legs.javascript.envelope)),
      Buffer.from(direct),
      'K0_THREE_LEG_DIVERGENCE: the emitted JavaScript envelope is not byte-identical to RT-1',
    );
    assert.deepEqual(
      Buffer.from(envelopeBytes(legs.python.envelope)),
      Buffer.from(direct),
      'K0_THREE_LEG_DIVERGENCE: the emitted Python envelope is not byte-identical to RT-1',
    );
    const directCalls = legs.direct.calls.map(({ namespace, operation }) => ({ namespace, operation }));
    assert.deepEqual(legs.javascript.calls, directCalls);
    assert.deepEqual(legs.python.calls, directCalls);
  });
}
