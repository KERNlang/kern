import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POSITIONS,
  SHAPE_NAMES,
  assertThresholdParity,
  assertWithAdmitted,
  completionBudget,
  fixtureArguments,
  javascriptCompletionBudget,
} from './k0-support.mjs';

// A step search on a program that does not link reports "no budget in the scanned range", which
// names the symptom instead of the cause. The admission check runs first so an unadmitted `with`
// fails this file with the linker's own refusal.
async function budget(name, args = 'one-element') {
  const source = POSITIONS[name]();
  await assertWithAdmitted(name, source);
  return completionBudget(source, fixtureArguments(source, args), `f-meter-${name}-${args}`);
}

// QF-1. Never an absolute count: the whole claim is that `with` charges exactly what its expansion
// charges, so every row is a difference against a twin measured in the same run.
for (const shape of SHAPE_NAMES) {
  test(`the ${shape} with charges exactly what its expansion twin charges on RT-1`, async () => {
    const surface = await budget(`with-${shape}`);
    const twin = await budget(`twin-${shape}`);
    assert.equal(
      surface.execution,
      twin.execution,
      `F_METER_NEW_SHAPE: the ${shape} with charged ${surface.execution} steps against its twin's ${twin.execution}`,
    );
    assert.equal(
      surface.link,
      twin.link,
      `F_METER_LINK_SHAPE: the ${shape} with must also link within its twin's link budget`,
    );
  });
}

// The byte half of the same claim: the two legs must exhaust at the SAME step, so a leg that charged
// the cleanup at a different moment fails here even when the totals agree.
for (const shape of SHAPE_NAMES) {
  test(`the ${shape} with exhausts at the same step on both legs`, async () => {
    const source = POSITIONS[`with-${shape}`]();
    await assertWithAdmitted(`with-${shape}`, source);
    await assertThresholdParity(shape, source, fixtureArguments(source, 'one-element'));
  });
}

// The emitted thresholds must also agree between the surface and the twin. RT-1 equality alone
// would still permit a JavaScript lowering that spent its steps in a different order.
for (const shape of ['fallthrough', 'return', 'caught-throw']) {
  test(`the emitted ${shape} with exhausts at its twin's JavaScript threshold`, async () => {
    const surfaceSource = POSITIONS[`with-${shape}`]();
    await assertWithAdmitted(`with-${shape}`, surfaceSource);
    const twinSource = POSITIONS[`twin-${shape}`]();
    const surface = await javascriptCompletionBudget(
      surfaceSource,
      fixtureArguments(surfaceSource, 'one-element'),
      `f-js-with-${shape}`,
    );
    const twin = await javascriptCompletionBudget(
      twinSource,
      fixtureArguments(twinSource, 'one-element'),
      `f-js-twin-${shape}`,
    );
    assert.equal(
      surface,
      twin,
      `F_METER_NEW_SHAPE: the emitted ${shape} with exhausts at ${surface} against its twin's ${twin}`,
    );
  });
}

// The return is charged ONCE, at the return site, not again after the cleanup. Measured as a
// difference of differences so no absolute count enters: the return-versus-assign delta must be the
// same through a `with` as it is through the hand-written expansion.
test('a return through the cleanup is charged exactly once', async () => {
  const surfaceReturn = await budget('with-return');
  const surfaceFall = await budget('with-fallthrough');
  const twinReturn = await budget('twin-return');
  const twinFall = await budget('twin-fallthrough');
  assert.equal(
    surfaceReturn.execution - surfaceFall.execution,
    twinReturn.execution - twinFall.execution,
    'F_METER_RETURN_TWICE: a return through a with cleanup must cost what it costs through the expansion',
  );
});

// A throw through the cleanup pays the throw boundary, the settle step and the finally entry -- the
// same three D pins for a finally-bearing try. The comparison is against the twin, again.
test('a throw through the cleanup costs the same caught and uncaught as its expansion', async () => {
  for (const shape of ['caught-throw', 'uncaught-throw']) {
    const surface = await budget(`with-${shape}`);
    const twin = await budget(`twin-${shape}`);
    assert.equal(
      surface.execution,
      twin.execution,
      `F_METER_NEW_SHAPE: the ${shape} with charged ${surface.execution} against its twin's ${twin.execution}`,
    );
  }
});

// The cleanup is charged once per block entry, never once per trip: a loop inside the body must move
// the total by exactly the loop's own cost, which the twin also pays.
test('a loop inside the body adds only the loop cost, never a second cleanup charge', async () => {
  const loop = await budget('with-break-inner-loop');
  const plain = await budget('with-fallthrough');
  const twinLoop = await budget('twin-break-inner-loop');
  const twinPlain = await budget('twin-fallthrough');
  assert.equal(
    loop.execution - plain.execution,
    twinLoop.execution - twinPlain.execution,
    'F_METER_CLEANUP_PER_TRIP: the loop delta must be identical through the with and through the expansion',
  );
});
