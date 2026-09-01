import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { CENSUS_DIR, CENSUS_FORMAT, admitFile, readJson, sha256Hex } from './support.mjs';
import { parseArguments, sweep, trackedKernFiles } from './sweep.mjs';

// RT-7 births the ratchet. The floor and the birth file live in the test source so that deleting a
// row from admitted.json cannot quietly lower the bar.
const RATCHET_FLOOR = 1;
const RT7_BIRTH = 'examples/kern-5-preview-app/ui.kern';

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
  assert.equal(sample.rejected.length, 5, 'the fast test pins exactly five known-rejected files');
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
    const final = sweep({ files, out, timeoutMs: 1, update: false }, (line) => {
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
    sweep({ files: files.slice(0, 3), out: join(directory, 'admission.json'), timeoutMs: 1, update: false }, () => {});
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
  assert.equal(await corpusDigest(files), before, 'the census must not modify the corpus it measures');
});

test('--update rewrites the ratchet only from a complete tracked sweep', () => {
  assert.equal(parseArguments([]).update, false, 'the ratchet is never rewritten implicitly');
  assert.equal(parseArguments(['--update']).update, true);
  assert.throws(() => parseArguments(['--update', '--files', RT7_BIRTH]), /complete tracked sweep/u);
});

async function corpusDigest(files) {
  const parts = [];
  for (const file of files) parts.push(`${file}:${sha256Hex(await readFile(resolve(CENSUS_DIR, '../..', file)))}`);
  return sha256Hex(parts.join('\n'));
}
