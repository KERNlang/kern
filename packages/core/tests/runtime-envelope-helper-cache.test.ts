import {
  lookupRunnerCallCache,
  prepareRunnerCallCacheKey,
  type RunnerCallCache,
  rememberRunnerCallCache,
} from '../src/ir/semantics/runner-call-cache.js';

function prepared(values: readonly unknown[], provenance = values.map(() => false)) {
  const key = prepareRunnerCallCacheKey(['module', 'helper'], values, provenance);
  if (!key) throw new Error('expected cacheable key');
  return key;
}

test('top-level strings use collision-free content paths without terminal copies', () => {
  const cache: RunnerCallCache = new Map();
  const leftTape = ['same', '-tape'].join('');
  const equalTape = `same-${'tape'}`;
  const otherTape = 'other-tape';
  const left = prepared([leftTape, 7], [false, true]);
  const equal = prepared([equalTape, 7], [false, true]);
  const other = prepared([otherTape, 7], [false, true]);

  expect(left.terminal).not.toContain(leftTape);
  rememberRunnerCallCache(cache, left, 'left', 4);
  expect(lookupRunnerCallCache(cache, equal)).toEqual({ hit: true, value: 'left' });
  expect(lookupRunnerCallCache(cache, other)).toEqual({ hit: false });
});

test('encoded length preserves the legacy helper-cache observer contract', () => {
  const tape = `line\n${'x'.repeat(4_096)}"\\end`;
  const values = [tape, 7, ['nested', true]];
  const provenance = [false, true, false];
  const key = prepareRunnerCallCacheKey([], values, provenance);
  if (!key) throw new Error('expected cacheable key');

  expect(key.terminal).not.toContain(tape);
  expect(key.encodedLength).toBe(JSON.stringify(values.map((value, index) => [value, provenance[index]])).length);
});

test('encoded length matches JSON boundaries and serializes nested values once', () => {
  let serializations = 0;
  const nested = {
    toJSON() {
      serializations += 1;
      return ['nested', '\ud800', '\udc00', '😀'];
    },
  };
  const controls = Array.from({ length: 0x20 }, (_, code) => String.fromCharCode(code)).join('');
  const values = [`${controls}"\\\ud800\udc00😀`, nested];
  const provenance = [false, false];
  const key = prepareRunnerCallCacheKey([], values, provenance);
  if (!key) throw new Error('expected cacheable key');

  expect(serializations).toBe(1);
  const legacyValues = [values[0], ['nested', '\ud800', '\udc00', '😀']];
  expect(key.encodedLength).toBe(JSON.stringify(legacyValues.map((value, index) => [value, provenance[index]])).length);
});

test('FIFO eviction prunes structural leaves and reinsertion is a safe miss', () => {
  const cache: RunnerCallCache = new Map();
  const first = prepared(['tape-a', 0]);
  const second = prepared(['tape-b', 0]);
  const third = prepared(['tape-c', 0]);

  rememberRunnerCallCache(cache, first, 'a', 2);
  rememberRunnerCallCache(cache, second, 'b', 2);
  expect(lookupRunnerCallCache(cache, first).hit).toBe(true);
  rememberRunnerCallCache(cache, third, 'c', 2);
  expect(cache.size).toBe(2);
  expect(lookupRunnerCallCache(cache, first)).toEqual({ hit: false });
  expect(lookupRunnerCallCache(cache, second)).toEqual({ hit: true, value: 'b' });
  expect(lookupRunnerCallCache(cache, third)).toEqual({ hit: true, value: 'c' });
});

test('non-string mutation and integer provenance remain terminal-key separated', () => {
  const cache: RunnerCallCache = new Map();
  const values = [1, 2];
  const original = prepared(['tape', values, 1], [false, false, true]);
  rememberRunnerCallCache(cache, original, 'original', 8);
  values.push(3);

  expect(lookupRunnerCallCache(cache, prepared(['tape', values, 1], [false, false, true]))).toEqual({ hit: false });
  expect(lookupRunnerCallCache(cache, original)).toEqual({ hit: true, value: 'original' });
  expect(lookupRunnerCallCache(cache, prepared(['tape', [1, 2], 1], [false, false, false]))).toEqual({
    hit: false,
  });
});
