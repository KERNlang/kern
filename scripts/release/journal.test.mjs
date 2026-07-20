import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DefaultJournalSink } from './journal.mjs';
import { plan } from './registry-test-fixtures.mjs';

test('journal reopens the same release without losing earlier phase evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kern-journal-test-'));
  const journalPath = path.join(root, 'journal.json');
  const options = { journalPath, plan, bundleName: 'bundle', bundleDigest: null };
  try {
    const first = await DefaultJournalSink.open(options);
    await first.writeEvent({
      phase: 'publish-pack',
      packageName: null,
      operation: 'create',
      outcome: 'succeeded',
    });
    const second = await DefaultJournalSink.open(options);
    await second.writeEvent({
      phase: 'publish-reconcile',
      packageName: '@kernlang/core',
      operation: 'verify',
      outcome: 'succeeded',
    });
    const stored = JSON.parse(await readFile(journalPath, 'utf8'));
    assert.deepEqual(stored.events.map((event) => event.phase), ['publish-pack', 'publish-reconcile']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('corrupt journal evidence restarts safely and secret-shaped text is redacted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kern-journal-corrupt-'));
  const journalPath = path.join(root, 'journal.json');
  try {
    await writeFile(journalPath, '{bad json');
    const journal = await DefaultJournalSink.open({
      journalPath,
      plan,
      bundleName: 'bundle',
      bundleDigest: null,
    });
    await journal.writeEvent({
      phase: 'test',
      packageName: null,
      operation: 'redact',
      outcome: 'failed',
      error: new Error('Authorization: token-value token=abc eyJabc.def.ghi'),
    });
    const stored = JSON.parse(await readFile(journalPath, 'utf8'));
    assert.equal(stored.events[0].operation, 'recover-existing-evidence');
    assert.doesNotMatch(stored.events[1].error, /token-value|token=abc|eyJabc/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
