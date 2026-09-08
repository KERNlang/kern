import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTRACTS_MARKER_ORDER,
  CONTRACTS_SCRAPE_TESTS,
  LINK_RETAINED_MARKERS,
  LINK_SUPPORT_MARKERS,
  REPOINTED_SCRAPES,
  SETTLED_SCRAPES,
  STATEMENTS_MARKERS,
  WALKER_MARKERS,
} from './markers.mjs';
import { LINKED_DIR, between, exists, occurrences, readRepositoryText } from './support.mjs';

const CONTRACTS = `${LINKED_DIR}/contracts.ts`;
const LINK = `${LINKED_DIR}/link.ts`;
const LINK_SUPPORT = `${LINKED_DIR}/link-support.ts`;
const STATEMENTS = `${LINKED_DIR}/statements.ts`;
const WALKERS = `${LINKED_DIR}/walkers.ts`;

test('exactly thirteen prior-slice files scrape linked-kir-program/contracts.ts by path', () => {
  assert.equal(
    CONTRACTS_SCRAPE_TESTS.length,
    13,
    'D0_SCRAPE_SURFACE_DRIFT: the contracts.ts scrape surface is no longer thirteen files',
  );
  for (const path of CONTRACTS_SCRAPE_TESTS) {
    assert.ok(exists(path), `D0_SCRAPE_SURFACE_DRIFT: ${path} no longer exists`);
    assert.ok(
      readRepositoryText(path).includes('linked-kir-program/contracts.ts'),
      `D0_SCRAPE_SURFACE_DRIFT: ${path} no longer names linked-kir-program/contracts.ts`,
    );
  }
});

function assertBoundedScrape(row) {
  assert.ok(exists(row.readsAfter), `D0_MARKER_HOMELESS: ${row.readsAfter} does not exist`);
  const source = readRepositoryText(row.readsAfter);
  const start = source.indexOf(row.start);
  assert.ok(start >= 0, `D0_MARKER_HOMELESS: ${row.id} start marker absent from ${row.readsAfter}`);
  const end = source.indexOf(row.end, start + row.start.length);
  assert.ok(end > start, `D0_MARKER_HOMELESS: ${row.id} end marker absent after the start marker`);
  const slice = between(source, row.start, row.end, `d0/${row.id}`);
  assert.ok(slice.length > 0, `D0_MARKER_HOMELESS: ${row.id} extracted an empty region`);
  assert.ok(
    slice.length < source.length - start,
    `D0_SCRAPE_UNBOUNDED: ${row.id} extracted the whole remainder of ${row.readsAfter}`,
  );
}

test('the twenty-one settled scrapes keep both markers, bounded, in the file they already read', () => {
  assert.equal(SETTLED_SCRAPES.length, 21, 'D0_SCRAPE_SURFACE_DRIFT: the settled scrape set moved');
  for (const row of SETTLED_SCRAPES) {
    const source = readRepositoryText(row.test);
    assert.ok(
      source.includes(row.readsAfter),
      `D0_SCRAPE_REPOINT: ${row.id} must keep reading ${row.readsAfter}`,
    );
    assertBoundedScrape(row);
  }
});

test('the one re-pointed scrape reads link-support.ts and finds the leaf pair bounded there', () => {
  assert.equal(REPOINTED_SCRAPES.length, 1, 'D0_SCRAPE_SURFACE_DRIFT: the re-point set moved');
  for (const row of REPOINTED_SCRAPES) {
    const source = readRepositoryText(row.test);
    assert.ok(
      source.includes(row.readsAfter),
      `D0_SCRAPE_REPOINT: ${row.id} must read ${row.readsAfter} after the split`,
    );
    assertBoundedScrape(row);
  }
});

test('the six INV-1 markers stay in contracts.ts, once each, in the pinned relative order', () => {
  const source = readRepositoryText(CONTRACTS);
  let previous = -1;
  for (const marker of CONTRACTS_MARKER_ORDER) {
    assert.equal(
      occurrences(source, marker),
      1,
      `D0_MARKER_LOCALITY: ${marker} must occur exactly once in contracts.ts`,
    );
    const at = source.indexOf(marker);
    assert.ok(at > previous, `D0_MARKER_LOCALITY: ${marker} is out of the pinned INV-1 order`);
    previous = at;
  }
});

test('the walker block moves to walkers.ts and leaves contracts.ts', () => {
  assert.ok(exists(WALKERS), `D0_WALKERS_MISSING: ${WALKERS} does not exist`);
  const walkers = readRepositoryText(WALKERS);
  for (const marker of WALKER_MARKERS) {
    assert.equal(
      occurrences(walkers, marker),
      1,
      `D0_WALKERS_MISSING: ${marker} must be declared exactly once in walkers.ts`,
    );
  }
});

test('contracts.ts no longer declares the walker block', () => {
  const contracts = readRepositoryText(CONTRACTS);
  for (const marker of WALKER_MARKERS) {
    assert.equal(
      occurrences(contracts, `\n${marker}`) + occurrences(contracts, `\nexport ${marker}`),
      0,
      `D0_WALKERS_RETAINED: ${marker} must not be declared in contracts.ts after the split`,
    );
  }
});

test('the KIR-node and scope helpers move to link-support.ts', () => {
  assert.ok(exists(LINK_SUPPORT), `D0_LINK_SUPPORT_MISSING: ${LINK_SUPPORT} does not exist`);
  const support = readRepositoryText(LINK_SUPPORT);
  for (const marker of LINK_SUPPORT_MARKERS) {
    assert.equal(
      occurrences(support, marker),
      1,
      `D0_LINK_SUPPORT_MISSING: ${marker} must be declared exactly once in link-support.ts`,
    );
  }
});

test('containsReturn and assertLeaf stay adjacent, in that order, with nothing declared between', () => {
  assert.ok(exists(LINK_SUPPORT), `D0_LEAF_PAIR_SPLIT: ${LINK_SUPPORT} does not exist`);
  const support = readRepositoryText(LINK_SUPPORT);
  const region = between(support, 'function containsReturn', 'function assertLeaf', 'd0/leaf-pair');
  assert.equal(
    occurrences(region, '\nfunction '),
    0,
    'D0_LEAF_PAIR_SPLIT: another function declaration sits between containsReturn and assertLeaf',
  );
  assert.equal(
    occurrences(region, '\nexport function '),
    0,
    'D0_LEAF_PAIR_SPLIT: an exported function sits between containsReturn and assertLeaf',
  );
});

test('the statement compilers move to statements.ts', () => {
  assert.ok(exists(STATEMENTS), `D0_STATEMENTS_MISSING: ${STATEMENTS} does not exist`);
  const statements = readRepositoryText(STATEMENTS);
  for (const marker of STATEMENTS_MARKERS) {
    assert.ok(
      statements.includes(marker),
      `D0_STATEMENTS_MISSING: ${marker} must be declared in statements.ts`,
    );
  }
});

test('link.ts keeps the handler and entry layer and sheds the moved layers', () => {
  const link = readRepositoryText(LINK);
  for (const marker of LINK_RETAINED_MARKERS) {
    assert.equal(
      occurrences(link, marker),
      1,
      `D0_LINK_LAYER_DRIFT: ${marker} must stay declared exactly once in link.ts`,
    );
  }
  for (const marker of [...LINK_SUPPORT_MARKERS, ...STATEMENTS_MARKERS]) {
    assert.equal(
      occurrences(link, `\n${marker}`) + occurrences(link, `\nexport ${marker}`),
      0,
      `D0_LINK_LAYER_DRIFT: ${marker} must not be declared in link.ts after the split`,
    );
  }
});
