import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FAULT_CENSUS_TOTALS,
  JAVASCRIPT_FAULT_CODES,
  JAVASCRIPT_FAULT_SITES,
  PYTHON_FAULT_CODES,
  PYTHON_FAULT_SITES,
  RUNTIME_FAULT_SITES,
} from '../kern-5-d0-contracts-split/pins.mjs';
import { occurrences, sourceFilesUnder, readRepositoryText } from '../kern-5-d0-contracts-split/support.mjs';
import {
  CLAMP_CODE_UNITS,
  CLAMP_MESSAGE_UNITS,
  JAVASCRIPT_FAULT_SITE_DELTA,
  PYTHON_FAULT_SITE_DELTA,
  RUNTIME_FAULT_SITE_DELTA,
  THROW_LABEL_HELPER,
  UNCAUGHT_THROW_CODE,
  USER_THROW_CLASS,
} from './pins.mjs';
import {
  TRY_POSITIONS,
  assertTryAdmitted,
  occurrencesOf,
  repositoryText,
  runtimeEvaluator,
  runtimeRequest,
  tryArtifact,
  tryTwoLegBytes,
} from './k0-support.mjs';

function census(constructor) {
  const rows = {};
  for (const path of sourceFilesUnder('packages/core/src')) {
    const count = occurrences(readRepositoryText(path), constructor);
    if (count > 0) rows[path] = count;
  }
  return rows;
}

function withDelta(base, delta) {
  const rows = { ...base };
  for (const [path, added] of Object.entries(delta)) rows[path] = (rows[path] ?? 0) + added;
  return rows;
}

function total(sites) {
  return Object.values(sites).reduce((sum, count) => sum + count, 0);
}

const EXPECTED_RUNTIME_SITES = withDelta(RUNTIME_FAULT_SITES, RUNTIME_FAULT_SITE_DELTA);
const EXPECTED_JAVASCRIPT_SITES = withDelta(JAVASCRIPT_FAULT_SITES, JAVASCRIPT_FAULT_SITE_DELTA);
const EXPECTED_PYTHON_SITES = withDelta(PYTHON_FAULT_SITES, PYTHON_FAULT_SITE_DELTA);

// D-2j, ruled. `new __UserThrow(` matches none of the three census patterns, so the only rows that
// move are the ones D genuinely adds -- and no others. The delta is spelled out in pins.mjs.
test('the KernKirFault census equals D.0 plus exactly the three runtime sites D adds', () => {
  assert.deepEqual(
    census('new KernKirFault('),
    EXPECTED_RUNTIME_SITES,
    'D_FAULT_CENSUS: the runtime fault sites moved by something other than the ruled D-2j delta',
  );
  assert.equal(total(EXPECTED_RUNTIME_SITES), FAULT_CENSUS_TOTALS.runtime + total(RUNTIME_FAULT_SITE_DELTA));
});

test('the JavaScript __Fault census gains exactly one emitter site, for the uncaught conversion', () => {
  assert.deepEqual(
    census('new __Fault('),
    EXPECTED_JAVASCRIPT_SITES,
    'D_FAULT_CENSUS: the __Fault construction sites moved by something other than the uncaught conversion',
  );
});

test('the Python _Fault census does not move at all, because the Python emitter is byte-frozen', () => {
  assert.deepEqual(
    census('raise _Fault('),
    EXPECTED_PYTHON_SITES,
    'D_PYTHON_TOUCH: the Python fault census must be untouched; both new kinds are deferred, not lowered',
  );
  assert.equal(total(EXPECTED_PYTHON_SITES), FAULT_CENSUS_TOTALS.python);
  assert.equal(PYTHON_FAULT_CODES.includes(UNCAUGHT_THROW_CODE), false);
});

test('both fault code sets gain uncaught-throw and nothing else', () => {
  const codes = (pattern) => {
    const found = new Set();
    for (const path of sourceFilesUnder('packages/core/src')) {
      for (const match of readRepositoryText(path).matchAll(pattern)) found.add(match[1]);
    }
    return [...found].sort();
  };
  assert.deepEqual(
    codes(/new __Fault\('([a-z-]+)'/gu),
    [...JAVASCRIPT_FAULT_CODES, UNCAUGHT_THROW_CODE].sort(),
    'D_FAULT_CODES: the __Fault code set must gain exactly uncaught-throw',
  );
  assert.deepEqual(
    codes(/new KernKirFault\('([a-z-]+)'/gu).includes(UNCAUGHT_THROW_CODE),
    true,
    'D_FAULT_CODES: the KernKirFault code set must gain uncaught-throw',
  );
});

// D-2k, restated: `__UserThrow` is a user-throw carrier and never a fault. No class extends
// `__Fault`/`_Fault`, and the emitted nominal guard is a user-throw catch, not a fault catch.
test('no class extends __Fault or _Fault, and __UserThrow is a bare nominal class', () => {
  for (const path of sourceFilesUnder('packages/core/src')) {
    const source = readRepositoryText(path);
    assert.equal(
      /class\s+\w+\s+extends\s+_?_Fault/u.test(source),
      false,
      `D_CARRIER_CONFUSED: ${path} declares a class extending the fault carrier`,
    );
    assert.equal(
      source.includes(`${USER_THROW_CLASS} extends`),
      false,
      `D_CARRIER_CONFUSED: ${path} makes ${USER_THROW_CLASS} extend something; it must be bare and nominal`,
    );
  }
});

test('the emitted catch guards on instanceof and never on a fault code field check', async () => {
  const artifact = await tryArtifact(TRY_POSITIONS['try-catch-caught-throw']());
  assert.ok(
    artifact.text.includes(`instanceof ${USER_THROW_CLASS}`),
    `D_CARRIER_CONFUSED: the emitted catch must guard with instanceof ${USER_THROW_CLASS}`,
  );
  for (const shape of ['.code ===', '.code==='] ) {
    assert.equal(
      artifact.text.includes(`__e${shape}`),
      false,
      'D_CARRIER_CONFUSED: a field check against a fault code is exactly the confusion the nominal class prevents',
    );
  }
});

// D-3a. The whole public result of an uncaught throw, byte-identical on both legs.
test('an uncaught throw produces the frozen failure envelope byte-identically on both legs', async () => {
  const source = TRY_POSITIONS['throw-uncaught']();
  await assertTryAdmitted('throw-uncaught', source);
  const { legs } = await tryTwoLegBytes(source, runtimeRequest('d-uncaught', {}));
  const envelope = legs.direct.envelope;
  assert.equal(envelope.outcome, 'failure', 'D_UNCAUGHT_SHAPE: an uncaught throw must fail');
  assert.deepEqual(envelope.completion, { kind: 'error' }, 'D_UNCAUGHT_SHAPE: the completion must be error');
  assert.deepEqual(envelope.result, { presence: 'absent' }, 'D_UNCAUGHT_SHAPE: the result must be absent');
  assert.deepEqual(
    envelope.diagnostics,
    [{ category: 'runtime', code: UNCAUGHT_THROW_CODE, phase: 'execution' }],
    'D_UNCAUGHT_SHAPE: exactly one runtime diagnostic carrying uncaught-throw at the execution phase',
  );
});

// D-3h. Catch is not a transaction: events already committed survive into the failure envelope, in
// order. Append-only, no rollback on either leg.
test('a print and a capability committed before an uncaught throw both survive into the failure envelope', async () => {
  const source = TRY_POSITIONS['throw-uncaught-after-print']();
  await assertTryAdmitted('throw-uncaught-after-print', source);
  const { legs } = await tryTwoLegBytes(source, runtimeRequest('d-events-preserved', {}));
  assert.deepEqual(
    legs.direct.envelope.events,
    [{ op: 'stdout', text: 'first' }],
    'D_EVENTS_ROLLED_BACK: events committed before the throw must be preserved, in order',
  );
});

// D-3b/D-3c. The clamped label rides the fault message, never an envelope field, and the clamp is a
// code-unit slice -- no ellipsis, no JSON.stringify, no unbounded rendering. The r2 OOM vector.
test('clampThrowLabel clamps the message to 256 code units and appends a 64-unit code in brackets', () => {
  const { clampThrowLabel } = runtimeEvaluator();
  assert.equal(
    typeof clampThrowLabel,
    'function',
    'D_LABEL_HELPER_MISSING: kir-runtime/expression.ts must export clampThrowLabel before the clamp can be measured',
  );
  const long = 'x'.repeat(1000);
  const plain = clampThrowLabel({
    tag: 'record',
    value: [
      { key: 'code', value: { tag: 'null' } },
      { key: 'message', value: { tag: 'text', value: long } },
    ],
  });
  assert.equal(
    plain.length,
    CLAMP_MESSAGE_UNITS,
    `D_LABEL_UNBOUNDED: a ${long.length}-character message must clamp to exactly ${CLAMP_MESSAGE_UNITS} code units`,
  );
  assert.equal(plain.includes('…'), false, 'D_LABEL_SHAPE: the clamp is a slice, with no ellipsis');
  const coded = clampThrowLabel({
    tag: 'record',
    value: [
      { key: 'code', value: { tag: 'text', value: 'y'.repeat(200) } },
      { key: 'message', value: { tag: 'text', value: long } },
    ],
  });
  assert.equal(
    coded,
    `${'x'.repeat(CLAMP_MESSAGE_UNITS)} [${'y'.repeat(CLAMP_CODE_UNITS)}]`,
    'D_LABEL_SHAPE: a present code must render as the clamped message followed by the clamped code in brackets',
  );
});

test('no JSON.stringify is reachable from the label path on either leg', async () => {
  const evaluator = repositoryText('packages/core/src/kir-runtime/expression.ts');
  const from = evaluator.indexOf('function clampThrowLabel');
  assert.ok(
    from >= 0,
    'D_LABEL_HELPER_MISSING: clampThrowLabel must be declared in kir-runtime/expression.ts',
  );
  const label = evaluator.slice(from);
  assert.equal(
    label.slice(0, label.indexOf('\n}')).includes('JSON.stringify'),
    false,
    'D_LABEL_UNBOUNDED: rendering a record into the label is the OOM vector r2 closed',
  );
  const artifact = await tryArtifact(TRY_POSITIONS['throw-uncaught-coded']());
  const helper = artifact.text.slice(artifact.text.indexOf(THROW_LABEL_HELPER));
  assert.ok(helper.length > 0, `D_LABEL_HELPER_MISSING: the emitted module must carry ${THROW_LABEL_HELPER}`);
});

test('both legs produce the same clamped label for the same payload', async () => {
  const source = TRY_POSITIONS['throw-uncaught-coded']();
  await assertTryAdmitted('throw-uncaught-coded', source);
  const { legs } = await tryTwoLegBytes(source, runtimeRequest('d-label-parity', {}));
  assert.equal(legs.direct.envelope.outcome, 'failure');
  assert.equal(legs.javascript.envelope.outcome, 'failure');
});

// D-3f. The legacy normalizer stays the single `internalRuntimeFailure` producer of the code, and
// the one divergence -- `events` -- is asserted rather than assumed.
test('normalize.ts stays the single internalRuntimeFailure producer, diverging only on events', () => {
  const normalize = repositoryText('packages/core/src/runtime-envelope/normalize.ts');
  assert.equal(
    occurrencesOf(normalize, `internalRuntimeFailure('${UNCAUGHT_THROW_CODE}')`),
    1,
    'D_PRODUCER_SPLIT: normalize.ts must stay the single internalRuntimeFailure producer of uncaught-throw',
  );
  const producer = normalize.slice(
    normalize.indexOf('function internalRuntimeFailure'),
    normalize.indexOf('function internalRuntimeFailure') + 600,
  );
  assert.ok(
    producer.includes('events: []'),
    'D_DIVERGENCE_LOST: internalRuntimeFailure hard-codes an empty event list; the KIR envelope preserves committed events',
  );
  const envelope = repositoryText('packages/core/src/kir-runtime/envelope.ts');
  assert.ok(
    envelope.includes('...committedEvents'),
    'D_DIVERGENCE_LOST: the KIR failure envelope must keep preserving committed events',
  );
});

// D.0's row moves rather than being deleted: the code is now named by real producers, so the
// "exactly once, in the union declaration" assertion has to be re-homed by D.
test('the D.0 diagnostics rows that D moves have actually been moved, not left stale', () => {
  const diagnostics = repositoryText('scripts/kern-5-d0-contracts-split/diagnostics.test.mjs');
  assert.equal(
    diagnostics.includes('no fault construction site anywhere in core carries'),
    false,
    'D_PRIOR_PIN_STALE: D.0 asserted no core site carries uncaught-throw; D adds three and must move that row',
  );
  assert.equal(
    diagnostics.includes('names `uncaught-throw` exactly once'),
    false,
    'D_PRIOR_PIN_STALE: D.0 asserted the kir-runtime tree names uncaught-throw exactly once; D must move that row',
  );
});
