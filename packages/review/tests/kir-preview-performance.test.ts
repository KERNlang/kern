import assert from 'node:assert/strict';
import test from 'node:test';

import { diffCanonicalKirFacts } from '../src/kir-preview/diff.js';
import type { CanonicalKirFactModel, KirFact } from '../src/kir-preview/model.js';

function publicFact(side: 'base' | 'head', index: number): KirFact {
  const name = `${side}-${String(index).padStart(5, '0')}`;
  const key = `large.kern/fn/${name}`;
  return {
    facet: 'public-api',
    moduleId: 'large.kern',
    key,
    matchKey: key,
    value: `${side}-signature-${index}`,
    display: name,
    contentIdentity: `shared-content-${index}`,
  };
}

function model(facts: readonly KirFact[]): CanonicalKirFactModel {
  return { facts, semanticDigest: 'not-used-by-diff' };
}

test('large rename sets are indexed and remain deterministic', () => {
  const count = 5_000;
  const base = model(Array.from({ length: count }, (_, index) => publicFact('base', index)));
  const head = model(Array.from({ length: count }, (_, index) => publicFact('head', index)));

  const started = performance.now();
  const findings = diffCanonicalKirFacts(base, head);
  const elapsed = performance.now() - started;

  assert.equal(findings.length, count);
  assert.ok(findings.every((finding) => finding.change === 'removed-added-or-rename'));
  assert.deepEqual(findings, diffCanonicalKirFacts(base, head));
  assert.ok(elapsed < 2_000, `indexed 5k rename diff took ${elapsed.toFixed(1)}ms`);
});

test('ambiguous duplicate content identities remain additions and removals', () => {
  const before = publicFact('base', 0);
  const after = publicFact('head', 0);
  const base = model([
    before,
    {
      ...before,
      key: `${before.key}-duplicate`,
      matchKey: `${before.matchKey}-duplicate`,
    },
  ]);
  const head = model([
    after,
    {
      ...after,
      key: `${after.key}-duplicate`,
      matchKey: `${after.matchKey}-duplicate`,
    },
  ]);

  const findings = diffCanonicalKirFacts(base, head);
  assert.equal(findings.length, 4);
  assert.ok(findings.every((finding) => finding.change === 'added' || finding.change === 'removed'));
});
