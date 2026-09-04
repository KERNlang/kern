import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { CENSUS_DIR, CENSUS_FORMAT, admitFile, readJson, sha256Hex } from './support.mjs';
import {
  corpusInvariantFailures,
  parseArguments,
  ratchetRefusals,
  sweep,
  trackedKernFiles,
  whitelistFiles as readWhitelistFiles,
  writeAtomic,
} from './sweep.mjs';

// RT-7 births the ratchet. The floor and the birth file live in the test source so that deleting a
// row from admitted.json cannot quietly lower the bar.
const RATCHET_FLOOR = 1;
const RT7_BIRTH = 'examples/kern-5-preview-app/ui.kern';
// The files that clear F5 and stop only at the missing export are the nearest thing to an
// accidental admission, so the sampled fence must always carry all three.
const F5_CLEARING = [
  'examples/agon-engine-islands.kern',
  'examples/kern-frontend/builtin-node-types.generated.kern',
  'examples/kern-frontend/f1-scan-catalog.kern',
];

const ratchet = await readJson(resolve(CENSUS_DIR, 'admitted.json'));
const sample = await readJson(resolve(CENSUS_DIR, 'rejected-sample.json'));

const whitelist = ratchet.admitted;
const whitelistFiles = whitelist.map((row) => row.file);

// Each admission runs the three legs, so the fast test resolves every file once and shares it.
const admissions = new Map();
function admit(file) {
  if (!admissions.has(file)) admissions.set(file, admitFile(file));
  return admissions.get(file);
}

test('the committed ratchet is the RT-7 birth value and never sinks below its floor', () => {
  assert.equal(ratchet.format, CENSUS_FORMAT);
  assert.ok(
    whitelist.length >= RATCHET_FLOOR,
    `the admission ratchet is monotone: expected at least ${RATCHET_FLOOR} whitelisted file, found ${whitelist.length}`,
  );
  assert.ok(whitelistFiles.includes(RT7_BIRTH), `${RT7_BIRTH} left the whitelist; the ratchet may not run backwards`);
  assert.deepEqual(whitelistFiles, [...whitelistFiles].sort(), 'the whitelist is stored in file order');
});

test('the whitelist and the pinned rejection sample are disjoint', () => {
  assert.equal(sample.format, CENSUS_FORMAT);
  assert.ok(sample.rejected.length >= 7, `the sampled fence shrank to ${sample.rejected.length} files`);
  const sampled = sample.rejected.map((row) => row.file);
  for (const file of F5_CLEARING) {
    assert.ok(sampled.includes(file), `${file} clears F5 and must stay in the sampled fence`);
  }
  for (const row of sample.rejected) {
    assert.ok(!whitelistFiles.includes(row.file), `${row.file} cannot be both whitelisted and pinned as rejected`);
  }
});

test('every whitelisted file is admitted end-to-end on all three legs today', async () => {
  for (const row of whitelist) {
    const result = await admit(row.file);
    assert.equal(
      result.admitted,
      true,
      `${row.file} left the admitted set at ${result.stage}/${result.code}; the ratchet may not run backwards`,
    );
    assert.equal(result.handlerName, row.handlerName);
    assert.equal(result.resultPresence, row.resultPresence);
    assert.equal(result.eventCount, row.eventCount);
    assert.equal(result.projectionArtifactSha256, row.projectionArtifactSha256, `${row.file}: F5 projection drifted`);
    assert.equal(result.linkedProgramSha256, row.linkedProgramSha256, `${row.file}: linked program drifted`);
    assert.equal(result.envelopeDigest, row.envelopeDigest, `${row.file}: the three-leg envelope drifted`);
  }
});

test('no file outside the whitelist is admitted', async () => {
  const admittedOutside = [];
  for (const row of sample.rejected) {
    const result = await admit(row.file);
    if (result.admitted) admittedOutside.push(row.file);
  }
  assert.deepEqual(
    admittedOutside,
    [],
    `newly admitted files must be ratcheted in deliberately with sweep.mjs --update: ${admittedOutside.join(', ')}`,
  );
});

test('the pinned rejection sample keeps its first diagnostic', async () => {
  for (const row of sample.rejected) {
    const result = await admit(row.file);
    assert.equal(result.stage, row.stage, `${row.file}: rejection stage drifted`);
    assert.equal(result.code, row.code, `${row.file}: first diagnostic drifted`);
  }
});

test('the admitted count never falls below the whitelist length', async () => {
  const scanned = [...whitelistFiles, ...sample.rejected.map((row) => row.file)];
  let admitted = 0;
  for (const file of scanned) {
    if ((await admit(file)).admitted) admitted += 1;
  }
  assert.ok(
    admitted >= whitelist.length,
    `admission is monotone: ${admitted} of ${scanned.length} scanned files admit, whitelist holds ${whitelist.length}`,
  );
  assert.equal(admitted, whitelist.length, 'the scanned sample admits exactly the whitelisted files');
});

test('the sweep records a hard per-file timeout, logs progress, and writes after every file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kern-5-census-'));
  try {
    const out = join(directory, 'admission.json');
    const files = [RT7_BIRTH, ...sample.rejected.slice(0, 2).map((row) => row.file)];
    const lines = [];
    const completedAtEachLine = [];
    const final = await sweep({ files, jobs: 1, out, timeoutMs: 1, update: false }, (line) => {
      lines.push(line);
      completedAtEachLine.push(JSON.parse(readFileSync(out, 'utf8')).completed);
    });
    assert.equal(lines.length, files.length, 'the sweep logs one progress line per file');
    assert.deepEqual(completedAtEachLine, [1, 2, 3], 'the report is written after every file, not only at the end');
    assert.equal(final.admittedCount, 0);
    for (const row of final.results) {
      assert.equal(row.timedOut, true, `${row.file} must record that its probe was killed`);
      assert.equal(row.timeoutMs, 1, `${row.file} must record the timeout it was killed by`);
      assert.equal(row.stage, 'timeout');
      assert.equal(row.code, 'probe-timeout');
    }
    const written = JSON.parse(await readFile(out, 'utf8'));
    assert.equal(written.completed, files.length);
    assert.equal(written.timeoutMs, 1);
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.endsWith('.tmp')),
      [],
      'every report lands by rename, leaving no partial file behind',
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('the sweep leaves every tracked .kern file untouched', async () => {
  const files = trackedKernFiles();
  assert.ok(files.length >= 240, `the tracked .kern corpus shrank to ${files.length}`);
  const before = await corpusDigest(files);
  const directory = await mkdtemp(join(tmpdir(), 'kern-5-census-'));
  try {
    await sweep(
      { files: files.slice(0, 3), jobs: 2, out: join(directory, 'admission.json'), timeoutMs: 1, update: false },
      () => {},
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
  assert.equal(await corpusDigest(files), before, 'the census must not modify the corpus it measures');
});

test('a concurrent sweep still reports its results in corpus order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kern-5-census-'));
  try {
    const files = trackedKernFiles().slice(0, 8);
    const out = join(directory, 'admission.json');
    const final = await sweep({ files, jobs: 4, out, timeoutMs: 1, update: false });
    assert.deepEqual(
      final.results.map((row) => row.file),
      files,
      'concurrency may not reorder the report',
    );
    assert.equal(final.completed, files.length);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('--update refuses to rewrite the ratchet from an incomplete or regressing sweep', () => {
  const clean = [{ admitted: true, file: RT7_BIRTH }];
  assert.deepEqual(ratchetRefusals(clean, [RT7_BIRTH]), [], 'a clean, non-shrinking sweep is accepted');

  for (const broken of [
    { admitted: false, code: 'probe-timeout', file: 'a.kern', stage: 'timeout' },
    { admitted: false, code: 'probe-exit', file: 'a.kern', stage: 'probe' },
    { admitted: false, code: 'probe-overflow', file: 'a.kern', stage: 'probe' },
  ]) {
    const refusals = ratchetRefusals([...clean, broken], [RT7_BIRTH]);
    assert.ok(
      refusals.some((line) => line.includes('did not complete cleanly')),
      `a ${broken.code} probe must refuse the update, got ${JSON.stringify(refusals)}`,
    );
  }

  const regressed = ratchetRefusals([{ admitted: false, file: RT7_BIRTH, stage: 'link' }], [RT7_BIRTH]);
  assert.ok(regressed.some((line) => line.includes('no longer admit')), 'a regressed whitelist entry refuses');

  const shrunk = ratchetRefusals([], [RT7_BIRTH]);
  assert.ok(shrunk.some((line) => line.includes('may only grow')), 'a shrinking ratchet refuses by default');
  assert.deepEqual(
    ratchetRefusals([], [RT7_BIRTH], { allowShrink: true }).filter((line) => line.includes('may only grow')),
    [],
    '--allow-shrink records a deliberate shrink',
  );
  assert.ok(
    ratchetRefusals([], [RT7_BIRTH], { allowShrink: true }).some((line) => line.includes('no longer admit')),
    '--allow-shrink still refuses a regressed whitelist entry',
  );
});

test('a failed report write leaves the previous report intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kern-5-census-'));
  try {
    const out = join(directory, 'admission.json');
    writeAtomic(out, 'first\n');
    assert.equal(readFileSync(out, 'utf8'), 'first\n');
    // Occupying the temp path makes the write fail after the previous report is already on disk.
    mkdirSync(`${out}.${process.pid}.tmp`);
    assert.throws(() => writeAtomic(out, 'second\n'));
    assert.equal(readFileSync(out, 'utf8'), 'first\n', 'a failed write must not truncate the previous report');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('an atomic report write refuses an occupied symlink temporary path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kern-5-census-'));
  try {
    const out = join(directory, 'admission.json');
    const target = join(directory, 'target.json');
    writeAtomic(out, 'first\n');
    writeFileSync(target, 'protected\n');
    symlinkSync(target, `${out}.${process.pid}.tmp`);
    assert.throws(() => writeAtomic(out, 'second\n'));
    assert.equal(readFileSync(out, 'utf8'), 'first\n');
    assert.equal(readFileSync(target, 'utf8'), 'protected\n');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

// The corpus-invariant CLI consumes this after the sweep resolves; a promise here would read as
// an empty whitelist and silently pass the invariant instead of failing.
test('the whitelist reader returns file names synchronously', () => {
  const files = readWhitelistFiles();
  assert.ok(Array.isArray(files), 'the reader must return an array, not a promise');
  assert.deepEqual(files, readWhitelistFiles(), 'repeated reads agree');
  assert.deepEqual(files, whitelistFiles, 'the reader agrees with admitted.json');
});

test('the corpus-wide invariant admits exactly the whitelist', () => {
  assert.deepEqual(corpusInvariantFailures([{ admitted: true, file: RT7_BIRTH }], [RT7_BIRTH]), []);
  assert.ok(
    corpusInvariantFailures(
      [{ admitted: true, file: RT7_BIRTH }, { admitted: true, file: 'extra.kern' }],
      [RT7_BIRTH],
    ).some((line) => line.includes('admitted but not whitelisted')),
    'an unwhitelisted admission violates the corpus invariant',
  );
  assert.ok(
    corpusInvariantFailures([], [RT7_BIRTH]).some((line) => line.includes('whitelisted but not admitted')),
    'a lost whitelist entry violates the corpus invariant',
  );
  for (const incomplete of [
    { admitted: false, code: 'probe-timeout', file: 'timeout.kern', stage: 'timeout' },
    { admitted: false, code: 'probe-exit', file: 'probe.kern', stage: 'probe' },
  ]) {
    assert.ok(
      corpusInvariantFailures([{ admitted: true, file: RT7_BIRTH }, incomplete], [RT7_BIRTH])
        .some((line) => line.includes('did not complete cleanly')),
      `${incomplete.code} invalidates the corpus invariant`,
    );
  }
});

test('--update rewrites the ratchet only from a complete tracked sweep', () => {
  assert.equal(parseArguments([]).update, false, 'the ratchet is never rewritten implicitly');
  assert.equal(parseArguments(['--update']).update, true);
  assert.throws(() => parseArguments(['--jobs', '0']), /--jobs must be a positive integer/u);
  assert.equal(parseArguments([]).allowShrink, false, 'a shrink is never allowed implicitly');
  assert.equal(parseArguments(['--allow-shrink']).allowShrink, true);
  assert.throws(() => parseArguments(['--update', '--files', RT7_BIRTH]), /complete tracked sweep/u);
});

async function corpusDigest(files) {
  const parts = [];
  for (const file of files) parts.push(`${file}:${sha256Hex(await readFile(resolve(CENSUS_DIR, '../..', file)))}`);
  return sha256Hex(parts.join('\n'));
}
