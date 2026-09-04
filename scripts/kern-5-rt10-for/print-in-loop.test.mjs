import assert from 'node:assert/strict';
import test from 'node:test';

import { CAPABILITY, CAPABILITY_EVENT, program, quoted, runtimeRequest, threeLegBytes } from './k0-support.mjs';

// RT10F-C3's Out of Scope correction flagged, but did not verify, that a `print` nested under an
// `if` inside a `for` body likely projects by the same mechanism a nested `capability` does — `if`'s
// `allowedChildren` is unrestricted, so it does not care whether its parent is `for`. Verified here:
// it does project, link and run, with byte-identical stdout ordering on all three legs, closing that
// flag rather than leaving it open.
const STDOUT_EVENT = Object.freeze({ op: 'stdout', text: 'tick' });

const PRINT_UNDER_IF_EVERY_TRIP = () =>
  program(
    ['for name=i from="0" to="3"', '  if cond="true"', `    print value=${quoted('tick')}`, `return value=${quoted('done')}`],
    { returns: 'string' },
  );

const PRINT_AND_CAPABILITY_UNDER_IF = () =>
  program([
    'let name=acc value="0"',
    'for name=i from="0" to="3"',
    '  if cond="true"',
    `    ${CAPABILITY}`,
    `    print value=${quoted('tick')}`,
    '  assign target="acc" value="acc + i"',
    'return value="acc"',
  ]);

test('a print nested under an if inside a for body projects, links and runs on all three legs', async () => {
  const { legs } = await threeLegBytes(PRINT_UNDER_IF_EVERY_TRIP(), runtimeRequest('rt10f-print-every-trip', {}));
  assert.equal(legs.direct.envelope.outcome, 'success');
  assert.deepEqual(legs.direct.envelope.result, { presence: 'value', value: { tag: 'text', value: 'done' } });
  assert.deepEqual(
    [...legs.direct.envelope.events],
    [STDOUT_EVENT, STDOUT_EVENT, STDOUT_EVENT],
    'RT10F_PRINT_LOOP_ORDER: one stdout event per trip, in trip order, identical on every leg',
  );
});

test('a print and a capability under the same if interleave per trip, identically on every leg', async () => {
  const { legs } = await threeLegBytes(
    PRINT_AND_CAPABILITY_UNDER_IF(),
    runtimeRequest('rt10f-print-and-capability', {}),
  );
  assert.equal(legs.direct.envelope.outcome, 'success');
  assert.deepEqual(legs.direct.envelope.result, { presence: 'value', value: { tag: 'integer', value: '3' } });
  assert.deepEqual(
    [...legs.direct.envelope.events],
    [
      CAPABILITY_EVENT,
      STDOUT_EVENT,
      CAPABILITY_EVENT,
      STDOUT_EVENT,
      CAPABILITY_EVENT,
      STDOUT_EVENT,
    ],
    'RT10F_PRINT_CAP_INTERLEAVE: the capability event and the print after it must alternate per trip, never batch',
  );
  assert.equal(legs.direct.calls.length, 3);
  assert.equal(legs.javascript.calls.length, 3);
  assert.equal(legs.python.calls.length, 3);
});
