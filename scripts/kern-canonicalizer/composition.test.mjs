import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  CANONICALIZER_COMPOSITE_PATH,
  CANONICALIZER_COMPOSITION_MEMBERS,
  canonicalCompositionRecordBytes,
  createCanonicalizerComposition,
  verifyCanonicalizerComposition,
} from './composition.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'kern-canonicalizer-composition-'));
  const sources = [
    'fn name=helper returns=void export=true\n  handler lang=kern\n    return\n',
    'fn name=canonicalize returns=void export=true\n  handler lang=kern\n    return\n',
  ];
  CANONICALIZER_COMPOSITION_MEMBERS.forEach((path, index) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, sources[index]);
  });
  const built = createCanonicalizerComposition({ root });
  const compositePath = join(root, CANONICALIZER_COMPOSITE_PATH);
  mkdirSync(dirname(compositePath), { recursive: true });
  writeFileSync(compositePath, built.compositeBytes);
  return { ...built, root };
}

function withFixture(run) {
  const fixture = fixtureRoot();
  try {
    run(fixture);
  } finally {
    rmSync(fixture.root, { force: true, recursive: true });
  }
}

test('composition authenticates the exact ordered checked-in executable bytes', () => {
  withFixture(({ compositeBytes, record, root }) => {
    const verified = verifyCanonicalizerComposition({ record, root });
    assert.deepEqual(verified.compositeBytes, compositeBytes);
    assert.equal(verified.source, compositeBytes.toString('utf8'));
    assert.equal(record.composite.sha256, digest(compositeBytes));
    assert.equal(record.composite.bytes, compositeBytes.length);
    assert.equal(
      canonicalCompositionRecordBytes(record).toString('utf8'),
      `${JSON.stringify(record, null, 2)}\n`,
    );
  });
});

test('composition rejects member reversal, omission, duplication, and path escape', () => {
  withFixture(({ record, root }) => {
    for (const mutate of [
      (copy) => copy.members.reverse(),
      (copy) => copy.members.pop(),
      (copy) => { copy.members[1] = structuredClone(copy.members[0]); },
      (copy) => { copy.members[0].path = '../outside.kern'; },
      (copy) => { copy.composite.path = CANONICALIZER_COMPOSITION_MEMBERS[0]; },
    ]) {
      const copy = structuredClone(record);
      mutate(copy);
      assert.throws(
        () => verifyCanonicalizerComposition({ record: copy, root }),
        /composition rejection:/u,
      );
    }
  });
});

test('composition rejects stale metadata and any checked-in composite byte drift', () => {
  withFixture(({ record, root }) => {
    for (const mutate of [
      (copy) => { copy.members[0].bytes += 1; },
      (copy) => { copy.members[0].sha256 = '0'.repeat(64); },
      (copy) => { copy.composite.bytes += 1; },
      (copy) => { copy.composite.sha256 = '0'.repeat(64); },
      (copy) => { copy.future = true; },
      (copy) => { copy.members[0].future = true; },
    ]) {
      const copy = structuredClone(record);
      mutate(copy);
      assert.throws(
        () => verifyCanonicalizerComposition({ record: copy, root }),
        /composition rejection:/u,
      );
    }

    const compositePath = join(root, CANONICALIZER_COMPOSITE_PATH);
    writeFileSync(compositePath, Buffer.concat([readFileSync(compositePath), Buffer.from('# appended\n')]));
    assert.throws(
      () => verifyCanonicalizerComposition({ record, root }),
      /composition rejection:/u,
    );
  });
});

test('composition rejects missing member LF, seam drift, and symlinks', () => {
  withFixture(({ record, root }) => {
    const memberPath = join(root, CANONICALIZER_COMPOSITION_MEMBERS[0]);
    const original = readFileSync(memberPath);
    writeFileSync(memberPath, original.subarray(0, original.length - 1));
    assert.throws(
      () => createCanonicalizerComposition({ root }),
      /exactly one trailing LF/u,
    );
  });

  withFixture(({ root }) => {
    const memberPath = join(root, CANONICALIZER_COMPOSITION_MEMBERS[0]);
    writeFileSync(memberPath, Buffer.concat([readFileSync(memberPath), Buffer.from('\n')]));
    assert.throws(
      () => createCanonicalizerComposition({ root }),
      /exactly one trailing LF/u,
    );
  });

  withFixture(({ root }) => {
    const memberPath = join(root, CANONICALIZER_COMPOSITION_MEMBERS[0]);
    rmSync(memberPath);
    mkdirSync(memberPath);
    assert.throws(
      () => createCanonicalizerComposition({ root }),
      /contained regular file/u,
    );
  });

  withFixture(({ record, root }) => {
    const memberPath = join(root, CANONICALIZER_COMPOSITION_MEMBERS[0]);
    const targetPath = join(root, 'member-target.kern');
    writeFileSync(targetPath, readFileSync(memberPath));
    rmSync(memberPath);
    symlinkSync(targetPath, memberPath);
    assert.throws(
      () => verifyCanonicalizerComposition({ record, root }),
      /contained regular file/u,
    );
  });

  withFixture(({ record, root }) => {
    const compositePath = join(root, CANONICALIZER_COMPOSITE_PATH);
    const targetPath = join(root, 'composite-target.kern');
    writeFileSync(targetPath, readFileSync(compositePath));
    rmSync(compositePath);
    symlinkSync(targetPath, compositePath);
    assert.throws(
      () => verifyCanonicalizerComposition({ record, root }),
      /contained regular file/u,
    );
  });
});
