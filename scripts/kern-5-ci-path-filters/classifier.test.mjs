import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyChanges } from '../ci/classify-ci-changes.mjs';

const pr = (files) => ({ eventName: 'pull_request', baseRef: 'main', files });
const added = (newPath) => ({ status: 'A', newPath });
const modified = (path) => ({ status: 'M', oldPath: path, newPath: path });
const renamed = (oldPath, newPath) => ({ status: 'R', oldPath, newPath });

test('every changed file ending in .md classifies as docs-only', () => {
  assert.equal(classifyChanges(pr([modified('README.md'), added('docs/guide.md')])), 'DOCS_ONLY');
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
  assert.equal(classifyChanges(pr([modified('scripts/kern-5-foo/README.md')])), 'FULL');
});

test('a markdown file under a kern-frontend slice directory forces full', () => {
  assert.equal(classifyChanges(pr([modified('scripts/kern-frontend-bar/notes.md')])), 'FULL');
});

test('a mix of markdown and source changes is full', () => {
  assert.equal(classifyChanges(pr([modified('README.md'), modified('packages/core/src/index.ts')])), 'FULL');
});

test('an empty diff is full', () => {
  assert.equal(classifyChanges(pr([])), 'FULL');
});

test('a push event is full regardless of the file list', () => {
  assert.equal(classifyChanges({ eventName: 'push', baseRef: 'main', files: [modified('README.md')] }), 'FULL');
});

test('uppercase and longer markdown-like extensions do not match the exact lowercase suffix', () => {
  assert.equal(classifyChanges(pr([modified('README.MD')])), 'FULL');
  assert.equal(classifyChanges(pr([modified('README.mdx')])), 'FULL');
  assert.equal(classifyChanges(pr([modified('README.markdown')])), 'FULL');
});

test('a file literally named .md has no basename and is full', () => {
  assert.equal(classifyChanges(pr([modified('.md')])), 'FULL');
  assert.equal(classifyChanges(pr([added('notes/.md')])), 'FULL');
});
