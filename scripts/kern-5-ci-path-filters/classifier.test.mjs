import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChanges } from '../ci/classify-ci-changes.mjs';

const pr = (files, extra = {}) => ({ eventName: 'pull_request', baseRef: 'main', files, ...extra });
const added = (newPath) => ({ status: 'A', newPath });
const modified = (path) => ({ status: 'M', oldPath: path, newPath: path });
const renamed = (oldPath, newPath) => ({ status: 'R', oldPath, newPath });
const neverReferenced = () => false;

test('every changed file ending in .md classifies as docs-only', () => {
  assert.equal(classifyChanges(pr([modified('kern-ci-fixture-a.md'), added('kern-ci-fixture-b.md')])), 'DOCS_ONLY');
});

test('a rename between two markdown paths stays docs-only', () => {
  assert.equal(classifyChanges(pr([renamed('old.md', 'new.md')])), 'DOCS_ONLY');
});

test('a rename landing on a non-markdown path is full, checking both sides', () => {
  assert.equal(classifyChanges(pr([renamed('old.md', 'new.ts')])), 'FULL');
});

test('a markdown file under .Codex/specs forces full', () => {
  assert.equal(classifyChanges(pr([modified('.Codex/specs/x.md')])), 'FULL');
});

test('a markdown file under a kern-5 slice directory forces full', () => {
  assert.equal(classifyChanges(pr([modified('scripts/kern-5-foo/kern-ci-fixture.md')])), 'FULL');
});

test('a markdown file under a kern-frontend slice directory forces full', () => {
  assert.equal(classifyChanges(pr([modified('scripts/kern-frontend-bar/notes.md')])), 'FULL');
});

test('a mix of markdown and source changes is full', () => {
  assert.equal(
    classifyChanges(pr([modified('kern-ci-fixture-a.md'), modified('packages/core/src/index.ts')])),
    'FULL',
  );
});

test('an empty diff is full', () => {
  assert.equal(classifyChanges(pr([])), 'FULL');
});

test('a push event is full regardless of the file list', () => {
  assert.equal(
    classifyChanges({ eventName: 'push', baseRef: 'main', files: [modified('kern-ci-fixture-a.md')] }),
    'FULL',
  );
});

test('uppercase and longer markdown-like extensions do not match the exact lowercase suffix', () => {
  assert.equal(classifyChanges(pr([modified('kern-ci-fixture-a.MD')])), 'FULL');
  assert.equal(classifyChanges(pr([modified('kern-ci-fixture-a.mdx')])), 'FULL');
  assert.equal(classifyChanges(pr([modified('kern-ci-fixture-a.markdown')])), 'FULL');
});

test('a file literally named .md has no basename and is full', () => {
  assert.equal(classifyChanges(pr([modified('.md')])), 'FULL');
  assert.equal(classifyChanges(pr([added('notes/.md')])), 'FULL');
});

test('a markdown file under examples/ forces full, a machine-read fixture tree', () => {
  assert.equal(classifyChanges(pr([modified('examples/rag-starter/corpus/refunds.md')])), 'FULL');
});

test('a markdown file under docs/ forces full, an infrastructure-read tree', () => {
  assert.equal(classifyChanges(pr([modified('docs/kern-5-support-matrix.md')])), 'FULL');
});

test('a markdown file under packages/ forces full', () => {
  assert.equal(classifyChanges(pr([modified('packages/core/kern-ci-fixture.md')])), 'FULL');
});

test('a markdown file under .github/ forces full', () => {
  assert.equal(classifyChanges(pr([modified('.github/ISSUE_TEMPLATE.md')])), 'FULL');
});

test('an eligible markdown file with no referencing non-markdown file stays docs-only', () => {
  assert.equal(classifyChanges(pr([modified('kern-ci-fixture-a.md')], { references: neverReferenced })), 'DOCS_ONLY');
});

test('a markdown file referenced by a non-markdown tracked file forces full', () => {
  const references = (candidate) => candidate === 'kern-ci-fixture-a.md';
  assert.equal(classifyChanges(pr([modified('kern-ci-fixture-a.md')], { references })), 'FULL');
});

test('an eligible markdown file with no references function provided stays docs-only', () => {
  assert.equal(classifyChanges(pr([modified('kern-ci-fixture-a.md')])), 'DOCS_ONLY');
});
