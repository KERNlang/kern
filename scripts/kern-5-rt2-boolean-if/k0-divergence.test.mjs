import assert from 'node:assert/strict';
import test from 'node:test';

import { envelopeBytes, handlerSource, runtimeRequest, threeLegs } from './k0-support.mjs';

const BOOLEAN_PARAMETER = Object.freeze([{ name: 'flag', type: 'boolean' }]);

const FIXTURES = Object.freeze([
  {
    args: { flag: { tag: 'boolean', value: true } },
    name: 'boolean parameter returned true',
    source: handlerSource('boolean', BOOLEAN_PARAMETER, ['return value="flag"']),
  },
  {
    args: { flag: { tag: 'boolean', value: false } },
    name: 'boolean parameter returned false',
    source: handlerSource('boolean', BOOLEAN_PARAMETER, ['return value="flag"']),
  },
  {
    args: { flag: { tag: 'boolean', value: false } },
    name: 'boolean literal binding ignores the parameter',
    source: handlerSource('boolean', BOOLEAN_PARAMETER, ['let name=held value="true"', 'return value="held"']),
  },
  {
    args: { flag: { tag: 'boolean', value: true } },
    name: 'boolean encoded through a record and printed',
    source: handlerSource('string', BOOLEAN_PARAMETER, [
      'let name=encoded value="Json.stringify({ flag: flag })"',
      'print value="encoded"',
      'return value="encoded"',
    ]),
  },
  {
    args: { flag: { tag: 'boolean', value: false } },
    name: 'false encoded through a record and printed',
    source: handlerSource('string', BOOLEAN_PARAMETER, [
      'let name=encoded value="Json.stringify({ flag: flag })"',
      'print value="encoded"',
      'return value="encoded"',
    ]),
  },
  {
    args: { flags: { tag: 'list', value: [{ tag: 'boolean', value: true }, { tag: 'boolean', value: false }] } },
    name: 'mixed boolean list round-trips',
    source: handlerSource('boolean[]', [{ name: 'flags', type: 'boolean[]' }], ['return value="flags"']),
  },
  {
    args: { flag: { tag: 'boolean', value: true } },
    name: 'boolean drives a capability result',
    source: handlerSource('string', BOOLEAN_PARAMETER, [
      'capability namespace=fixture operation=resolve name=reply',
      'let name=encoded value="Json.stringify({ flag: flag, reply: reply })"',
      'return value="encoded"',
    ]),
  },
]);

for (const fixture of FIXTURES) {
  test(`K0 three-leg boolean divergence: ${fixture.name}`, async () => {
    const requestId = `k0-${fixture.name.replaceAll(' ', '-')}`;
    const legs = await threeLegs(fixture.source, runtimeRequest(requestId, fixture.args));
    const direct = envelopeBytes(legs.direct.envelope);
    assert.equal(legs.direct.envelope.outcome, 'success', 'the K0 fixtures must execute successfully');
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
