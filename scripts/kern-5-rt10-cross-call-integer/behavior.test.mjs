import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPABILITY_EVENT,
  INT64_LIMIT,
  POSITIONS,
  TABLE_ROWS,
  admission,
  between,
  booleanSlot,
  emittedArtifacts,
  envelopeBytes,
  integerSlot,
  positionArguments,
  runtimeRequest,
  threeLegBytes,
} from './k0-support.mjs';

const PYTHON_INTEGER_TYPE_RECORD = `{"kind":_chars([${[...'integer'].map((char) => char.charCodeAt(0)).join(',')}])}`;
const JAVASCRIPT_INTEGER_TYPE_RECORD = 'Object.freeze({kind:"integer"})';

async function legs(name, requestId) {
  return threeLegBytes(POSITIONS[name](), runtimeRequest(requestId, positionArguments(name)));
}

async function envelope(name, requestId) {
  return (await legs(name, requestId)).legs.direct.envelope;
}

function specializedRegions(artifacts) {
  return {
    javascript: between(
      artifacts.javascript,
      'const __runSpecialized=',
      'const execute=async(input,executionOptions)',
      'the emitted JavaScript specialized handler',
    ),
    python: between(
      artifacts.python,
      'async def _run_specialized(',
      'async def execute(',
      'the emitted Python specialized handler',
    ),
  };
}

test('every frozen row stays inside the signed 64-bit range the number model reserves', () => {
  for (const row of TABLE_ROWS) {
    const value = BigInt(row.expected);
    assert.ok(value < INT64_LIMIT && value >= -INT64_LIMIT, `${row.name} result must stay inside i64`);
  }
});

for (const row of TABLE_ROWS) {
  test(`${row.name} crosses the call boundary as the frozen integer ${row.expected} on all three legs`, async () => {
    const result = await envelope(row.name, `rt10x-${row.name}`);
    assert.equal(result.outcome, 'success', row.name);
    assert.deepEqual(
      result.result,
      integerSlot(row.expected),
      `RT10X_VALUE_DRIFT: ${row.program} must equal the frozen ${row.expected}`,
    );
    assert.equal(result.events.length, row.capabilityEvents, `${row.name} committed the wrong number of events`);
  });
}

test('an integer-parameter helper returning a boolean crosses in both directions at once', async () => {
  const result = await envelope('int-param-only', 'rt10x-param-only');
  assert.deepEqual(result.result, booleanSlot(true));
  assert.deepEqual([...result.events], []);
});

test('an integer call result is statically integer, so a comparison over it returns a boolean', async () => {
  const result = await envelope('int-under-comparison', 'rt10x-under-comparison');
  assert.deepEqual(result.result, booleanSlot(true));
});

test('a crossed integer is tagged integer, so printing it fails at execution on every leg', async () => {
  const result = await envelope('int-print-tag', 'rt10x-print-tag');
  assert.equal(result.outcome, 'failure');
  assert.equal(result.diagnostics[0]?.code, 'unsupported-runtime-input');
  assert.deepEqual(result.result, { presence: 'absent' });
  assert.deepEqual([...result.events], []);
});

test('a crossed integer is not a boolean, so a boolean return position fails at execution', async () => {
  const result = await envelope('int-return-tag-mismatch', 'rt10x-return-tag');
  assert.equal(result.outcome, 'failure');
  assert.equal(result.diagnostics[0]?.code, 'invalid-handler-result');
  assert.deepEqual(result.result, { presence: 'absent' });
  assert.deepEqual([...result.events], []);
});

test('an integer helper that is declared and never called stays inert on every leg', async () => {
  const result = await envelope('int-uncalled-helper', 'rt10x-uncalled');
  assert.deepEqual(result.result, booleanSlot(true));
  assert.deepEqual([...result.events], []);
});

// RT-8 ruled the spelling dies at F5. The twin is asserted on the envelope bytes rather than on
// the value alone, so a spelling that survived anywhere downstream would separate here.
test('the number-spelled twin produces the byte-identical envelope of the integer-spelled call', async () => {
  const integerSpelling = await legs('int-both', 'rt10x-alias');
  const numberSpelling = await threeLegBytes(POSITIONS['number-spelling'](), runtimeRequest('rt10x-alias', {}));
  assert.deepEqual(
    Buffer.from(numberSpelling.bytes),
    Buffer.from(integerSpelling.bytes),
    'RT10X_ALIAS_DRIFT: the number spelling must be indistinguishable from the integer spelling',
  );
});

test('an async integer helper commits its capability event into the caller buffer in both positions', async () => {
  for (const [name, requestId] of [
    ['int-async-let', 'rt10x-async-let'],
    ['int-async-return', 'rt10x-async-return'],
  ]) {
    const result = await envelope(name, requestId);
    assert.deepEqual(result.result, integerSlot('7'), name);
    assert.deepEqual([...result.events], [CAPABILITY_EVENT], name);
  }
});

test('two accumulator steps through a helper accumulate, so the loop body shape composes', async () => {
  const once = await envelope('int-accumulator', 'rt10x-acc-1');
  const twice = await envelope('int-accumulator-twice', 'rt10x-acc-2');
  assert.deepEqual(once.result, integerSlot('7'));
  assert.deepEqual(twice.result, integerSlot('14'), 'the second assign reads the value the first wrote');
});

test('a synchronous integer helper is emitted synchronously and carries the integer type record', async () => {
  const artifacts = await emittedArtifacts(POSITIONS['int-both']());
  assert.ok(artifacts.javascript.includes('const __f0=('), 'the JavaScript helper must be a plain arrow');
  assert.equal(
    artifacts.javascript.includes('const __f0=async('),
    false,
    'RT10X_AWAIT_LEAK: a synchronous integer helper must not be emitted async',
  );
  assert.equal(/await __f0/u.test(artifacts.javascript), false, 'its call site must not be awaited');
  assert.ok(artifacts.python.includes('    def _f0('), 'the Python helper must be a plain def');
  assert.equal(
    artifacts.python.includes('async def _f0('),
    false,
    'RT10X_AWAIT_LEAK: a synchronous integer helper must not be emitted async on the Python leg',
  );
  assert.ok(
    artifacts.javascript.split(JAVASCRIPT_INTEGER_TYPE_RECORD).length - 1 >= 3,
    'the JavaScript leg guards the argument, the helper return and the entry return by type record',
  );
  assert.ok(
    artifacts.python.split(PYTHON_INTEGER_TYPE_RECORD).length - 1 >= 3,
    'the Python leg guards the same three positions by type record',
  );
});

test('an async integer helper is emitted async and awaited exactly at its statement position', async () => {
  const artifacts = await emittedArtifacts(POSITIONS['int-async-let']());
  assert.ok(artifacts.javascript.includes('const __f0=async('), 'the async helper must be emitted async');
  assert.ok(/await __f0\(\)/u.test(artifacts.javascript), 'its call site must be awaited');
  assert.ok(artifacts.python.includes('async def _f0('), 'the Python twin must be a coroutine');
  assert.ok(/await _f0\(\)/u.test(artifacts.python), 'Python must await the coroutine and never call it bare');
});

// A host double loses the low bit of every row past 2^53, so the value rows separate on it. This
// row separates on the *absence of the coercion* instead, which catches a leg that would only
// diverge on a magnitude no fixture happens to carry.
test('neither emitted specialized region coerces a crossed integer through a host number', async () => {
  for (const name of ['int-both', 'int-big-argument', 'int-arith-on-result']) {
    const regions = specializedRegions(await emittedArtifacts(POSITIONS[name]()));
    for (const token of ['Number(', 'parseInt', 'parseFloat', 'valueOf(']) {
      assert.equal(regions.javascript.includes(token), false, `${name}: the JavaScript leg must not use ${token}`);
    }
    for (const token of ['float(', 'int(', 'round(']) {
      assert.equal(regions.python.includes(token), false, `${name}: the Python leg must not use ${token}`);
    }
  }
});

test('the text and boolean argument controls still cross their own boundaries unchanged', async () => {
  const text = await threeLegBytes(POSITIONS['text-argument-control'](), runtimeRequest('rt10x-text-control', {}));
  assert.deepEqual(text.legs.direct.envelope.result, { presence: 'value', value: { tag: 'text', value: 'a' } });
  const boolean = await threeLegBytes(POSITIONS['bool-argument-control'](), runtimeRequest('rt10x-bool-control', {}));
  assert.deepEqual(boolean.legs.direct.envelope.result, booleanSlot(true));
});

test('every value row links on all three legs, so no row is satisfied by a shared refusal', async () => {
  for (const row of TABLE_ROWS) {
    const admitted = await admission(POSITIONS[row.name]());
    assert.equal(admitted.rt1, 'admitted', row.name);
    assert.equal(admitted.javascript, 'admitted', row.name);
    assert.equal(admitted.python, 'admitted', row.name);
  }
});

test('the envelope of an integer cross-call carries the value as a JSON string, never as a number', async () => {
  const { bytes } = await legs('int-big-argument', 'rt10x-wire');
  const wire = Buffer.from(bytes).toString('utf8');
  assert.ok(
    wire.includes('"value":"9223372036854775807"'),
    'RT10X_WIRE_DRIFT: the crossed integer must reach the wire as a quoted canonical decimal',
  );
  assert.equal(
    wire.includes('9223372036854776000'),
    false,
    'a host double would round the payload; the wire must never carry one',
  );
  assert.deepEqual(
    Buffer.from(envelopeBytes(JSON.parse(wire))),
    Buffer.from(bytes),
    'the envelope must round-trip through its own canonical serialization',
  );
});
