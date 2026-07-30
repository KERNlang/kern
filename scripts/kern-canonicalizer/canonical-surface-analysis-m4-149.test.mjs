import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  classifyQuotesourceCharacterM4149,
  evaluateQuotesourcePredicateM4149,
  loadPublishedCanonicalizerSurfaceAnalysisM4149,
  M4149_CANDIDATE_PREDICATE,
  M4149_CURRENT_PREDICATE,
  measureCanonicalizerSurfaceAnalysisM4149,
  validatePublishedCanonicalizerSurfaceAnalysisM4149,
} from './canonical-surface-analysis-m4-149.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM4148,
} from './coverage-residual-analysis-m4-148.mjs';
import { assertM4149CanonicalSurfaceAnalysis } from './coverage-m4-149-central.mjs';

const summaryUrl = new URL('./canonical-surface-analysis-m4-149.json', import.meta.url);
const PUBLISHED_DIGEST = 'bca47b2e75cd13cbbaa3b54e7e98e92f515e44f15cf92e3edea8c8c6bf59dc1d';
const BLOCKED_REASONS = [
  'if.properties.cond.expression.text.character-u007f',
  'if.properties.cond.expression.text.character-u0080',
  'if.properties.cond.expression.text.character-u009f',
  'if.properties.cond.expression.text.character-u2028',
  'if.properties.cond.expression.text.character-u2029',
  'if.properties.cond.expression.text.character-ufeff',
];
const SENTINELS = [
  { codePoint: 'U+007E', literal: '~', role: 'c1-lower-exclusive' },
  { codePoint: 'U+00A0', literal: '\\u00a0', role: 'c1-upper-exclusive' },
  { codePoint: 'U+2027', literal: '\\u2027', role: 'line-lower-exclusive' },
  { codePoint: 'U+202A', literal: '\\u202a', role: 'line-upper-exclusive' },
  { codePoint: 'U+FEFE', literal: '\\ufefe', role: 'bom-lower-exclusive' },
  { codePoint: 'U+FF00', literal: '\\uff00', role: 'bom-upper-exclusive' },
];

test('M4.149 evaluates only its mechanically rendered predicate contracts', () => {
  for (const codePoint of [0x00, 0x20, 0x7e, 0x7f, 0x80, 0x9f, 0xa0, 0x2028, 0xfeff]) {
    const value = String.fromCodePoint(codePoint);
    const classified = classifyQuotesourceCharacterM4149(value);
    assert.equal(
      evaluateQuotesourcePredicateM4149(M4149_CURRENT_PREDICATE, value),
      classified.current,
    );
    assert.equal(
      evaluateQuotesourcePredicateM4149(M4149_CANDIDATE_PREDICATE, value),
      classified.candidate,
    );
  }
  assert.throws(
    () => evaluateQuotesourcePredicateM4149(`${M4149_CANDIDATE_PREDICATE} `, '\u007f'),
    /predicate must be an exact mechanically rendered contract/u,
  );
});

test('M4.149 freezes and reproduces the exact quotesource canonical-surface decision', () => {
  const source = readFileSync(summaryUrl);
  const handoff = loadPublishedCanonicalizerSurfaceAnalysisM4149();
  assert.equal(createHash('sha256').update(source).digest('hex'), PUBLISHED_DIGEST);
  assert.equal(handoff.digest, PUBLISHED_DIGEST);
  assert.equal(handoff.inputCommit, '44ca4feda2901c16f79c7c5c40ede69394e60404');
  assert.deepEqual(handoff.record.baseline, {
    assignmentsDigest: 'e953208c40e51714c3e0338455f67437fb6a6fda6c3f9fb42df0870dda003720',
    blockerCount: 6,
    m4148Digest: 'bf5b7c6886f7f114995f59d916f4a87ecc2ea3f7fffc5289448d7ebb32abde2f',
    m4148InputCommit: '4115914127dc627edf8348af8a487ac1beae941a',
    quotesourceId:
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
    sourceDigest: 'c32414ee7aa6f29d092dc21de5065f04c4054c54d070dd4d964763047170ee2f',
  });
  assert.deepEqual(handoff.record.current, {
    blockedReasons: BLOCKED_REASONS,
    parameterRows: 2,
    predicate: M4149_CURRENT_PREDICATE,
    profileRows: { nodes: 54, properties: 82, values: 932 },
  });
  assert.deepEqual(handoff.record.candidate, {
    equivalence: { mismatches: 0, scalarValuesEvaluated: 1_112_064 },
    id: 'quotesource-neighbor-sentinel-rewrite',
    parameterRows: 2,
    predicate: M4149_CANDIDATE_PREDICATE,
    profileBlockers: [],
    profileRows: { nodes: 54, properties: 82, values: 932 },
    runtimeContract: 'portable-unicode-code-point-order',
    sentinels: SENTINELS,
  });
  assert.deepEqual(handoff.record.selectedNextAction, {
    action: 'replace-exact-quotesource-predicate',
    id: 'quotesource-neighbor-sentinel-rewrite',
    milestone: 'M4.150',
    source: 'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    witness:
      'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
  });
  assert.deepEqual(measureCanonicalizerSurfaceAnalysisM4149(), handoff.record);
  assert.equal(
    assertM4149CanonicalSurfaceAnalysis(),
    'M4.149 selects the exact quotesource neighbor-sentinel rewrite with zero profile blockers ' +
      'and 0 mismatches across 1112064 Unicode scalar values; M4.150 owns the KERN source rewrite.',
  );
});

test('M4.149 neighbor sentinels kill every boundary and preserve distant scalar values', () => {
  const blocked = new Set([
    ...Array.from({ length: 0x20 }, (_, codePoint) => codePoint),
    0x7f, 0x80, 0x81, 0x9e, 0x9f,
    0x2028, 0x2029, 0xfeff,
  ]);
  for (const codePoint of [
    0x00, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x1f, 0x20,
    0x7e, 0x7f, 0x80, 0x81, 0x9e, 0x9f, 0xa0,
    0x2027, 0x2028, 0x2029, 0x202a,
    0xfefe, 0xfeff, 0xff00, 0xffff, 0x1f600, 0x10ffff,
  ]) {
    const result = classifyQuotesourceCharacterM4149(String.fromCodePoint(codePoint));
    assert.equal(result.codePoint, codePoint);
    assert.equal(result.current, blocked.has(codePoint), `current U+${codePoint.toString(16)}`);
    assert.equal(result.candidate, result.current, `candidate U+${codePoint.toString(16)}`);
  }
  for (const invalid of [
    '',
    'ab',
    '\ud800',
    '\udc00',
    '\udc00\ud800',
  ]) {
    assert.throws(
      () => classifyQuotesourceCharacterM4149(invalid),
      /coverage M4\.149 canonical-surface analysis rejection/u,
    );
  }
  assert.throws(
    () => classifyQuotesourceCharacterM4149(0x7f),
    /candidate input must be a string/u,
  );
});

test('M4.149 published digest rejects canonical and hostile object drift', () => {
  const published = loadPublishedCanonicalizerSurfaceAnalysisM4149().record;
  for (const mutate of [
    (copy) => { copy.format = 'kern.kir-canonicalizer.canonical-surface-analysis.2'; },
    (copy) => { copy.future = true; },
    (copy) => { copy.baseline.blockerCount = 5; },
    (copy) => { copy.current.blockedReasons.pop(); },
    (copy) => { copy.candidate.equivalence.mismatches = 1; },
    (copy) => { copy.candidate.equivalence.scalarValuesEvaluated = -0; },
    (copy) => { copy.candidate.profileBlockers.push('profile.rows.values'); },
    (copy) => { copy.candidate.sentinels.reverse(); },
    (copy) => { copy.selectedNextAction.milestone = 'M4.151'; },
  ]) {
    const copy = structuredClone(published);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerSurfaceAnalysisM4149(copy),
      /coverage M4\.149 canonical-surface analysis rejection/u,
    );
  }

  const decorated = Object.assign(Object.create({ inherited: true }), published);
  assert.throws(
    () => validatePublishedCanonicalizerSurfaceAnalysisM4149(decorated),
    /coverage M4\.149 canonical-surface analysis rejection/u,
  );

  const readOnly = structuredClone(published);
  Object.defineProperty(readOnly.candidate.equivalence, 'mismatches', {
    configurable: true,
    enumerable: true,
    value: 0,
    writable: false,
  });
  assert.throws(
    () => validatePublishedCanonicalizerSurfaceAnalysisM4149(readOnly),
    /coverage M4\.149 canonical-surface analysis rejection/u,
  );

  const fixedLength = structuredClone(published);
  Object.defineProperty(fixedLength.candidate.sentinels, 'length', { writable: false });
  assert.throws(
    () => validatePublishedCanonicalizerSurfaceAnalysisM4149(fixedLength),
    /coverage M4\.149 canonical-surface analysis rejection/u,
  );

  const shared = structuredClone(published);
  shared.candidate.future = shared.current;
  shared.future = shared.current;
  assert.throws(
    () => validatePublishedCanonicalizerSurfaceAnalysisM4149(shared),
    /coverage M4\.149 canonical-surface analysis rejection/u,
  );

  const cyclic = structuredClone(published);
  cyclic.future = cyclic;
  assert.throws(
    () => validatePublishedCanonicalizerSurfaceAnalysisM4149(cyclic),
    /coverage M4\.149 canonical-surface analysis rejection/u,
  );
});

test('M4.149 loader rejects missing, directory, symlink, malformed, and noncanonical input', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'kern-m4-149-receipt-')));
  try {
    const missing = pathToFileURL(join(directory, 'missing.json'));
    assert.throws(
      () => loadPublishedCanonicalizerSurfaceAnalysisM4149(missing),
      /published receipt must be a regular non-symlink file/u,
    );

    const childDirectory = join(directory, 'directory.json');
    mkdirSync(childDirectory);
    assert.throws(
      () => loadPublishedCanonicalizerSurfaceAnalysisM4149(pathToFileURL(childDirectory)),
      /published receipt must be a regular non-symlink file/u,
    );

    const link = join(directory, 'link.json');
    symlinkSync(summaryUrl, link);
    assert.throws(
      () => loadPublishedCanonicalizerSurfaceAnalysisM4149(pathToFileURL(link)),
      /published receipt must be a regular non-symlink file/u,
    );

    const malformed = join(directory, 'malformed.json');
    writeFileSync(malformed, '{');
    assert.throws(
      () => loadPublishedCanonicalizerSurfaceAnalysisM4149(pathToFileURL(malformed)),
      /published receipt must contain JSON/u,
    );

    const noncanonical = join(directory, 'noncanonical.json');
    writeFileSync(
      noncanonical,
      JSON.stringify(loadPublishedCanonicalizerSurfaceAnalysisM4149().record),
    );
    assert.throws(
      () => loadPublishedCanonicalizerSurfaceAnalysisM4149(pathToFileURL(noncanonical)),
      /published receipt must use canonical JSON bytes/u,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('M4.149 preserves M4.148 and loads byte-identically in a fresh process', () => {
  assert.equal(
    loadPublishedCanonicalizerResidualAnalysisM4148().digest,
    'bf5b7c6886f7f114995f59d916f4a87ecc2ea3f7fffc5289448d7ebb32abde2f',
  );
  const moduleUrl = new URL('./canonical-surface-analysis-m4-149.mjs', import.meta.url).href;
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import {loadPublishedCanonicalizerSurfaceAnalysisM4149 as load} from ` +
      `${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(load()))`,
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), loadPublishedCanonicalizerSurfaceAnalysisM4149());
});

test('M4.149 import and direct-invocation detection are fail-closed', () => {
  const moduleUrl = new URL('./canonical-surface-analysis-m4-149.mjs', import.meta.url).href;
  const stdin = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    input: `import ${JSON.stringify(moduleUrl)}; process.stdout.write('ok')`,
  });
  assert.equal(stdin.status, 0, stdin.stderr);
  assert.equal(stdin.stdout, 'ok');

  const placeholder = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import ${JSON.stringify(moduleUrl)}; process.stdout.write('ok')`,
    'not-a-repository-path',
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(placeholder.status, 0, placeholder.stderr);
  assert.equal(placeholder.stdout, 'ok');

  const directory = mkdtempSync(join(tmpdir(), 'kern-m4-149-entry-'));
  const link = join(directory, 'canonical-surface-analysis-m4-149.mjs');
  symlinkSync(new URL('./canonical-surface-analysis-m4-149.mjs', import.meta.url), link);
  try {
    const direct = spawnSync(process.execPath, [link], {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
    });
    assert.notEqual(direct.status, 0);
    assert.match(direct.stderr, /direct invocation requires exactly --write/u);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
