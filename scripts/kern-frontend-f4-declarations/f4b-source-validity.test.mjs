import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { validateSemantics } from '../../packages/core/dist/semantic-validator.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const WORKER_PATH = resolve(HERE, 'module-set-worker.mjs');
const POLICY_PATH = resolve(HERE, 'policy.json');

function compositionPaths(worker) {
  const match = /const COMPOSITION_PATHS = \[(?<entries>[\s\S]*?)\];/u.exec(worker);
  assert.ok(match?.groups?.entries, 'module-set worker must declare its composition paths');
  const paths = Array.from(match.groups.entries.matchAll(/'([^']+)'/gu), ([, path]) => path);
  assert.ok(paths.length > 0, 'module-set worker composition must not be empty');
  assert.equal(new Set(paths).size, paths.length, 'module-set worker paths must be unique');
  for (const path of paths) assert.match(path, /\.kern(?:part)?$/u, `unsupported composition path ${path}`);
  return paths;
}

function f4bComposition() {
  const worker = readFileSync(WORKER_PATH, 'utf8');
  const paths = compositionPaths(worker);

  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
  const descriptorByPath = new Map(policy.composition.map((descriptor) => [descriptor.path, descriptor]));
  return paths.map((path) => {
    assert.ok(descriptorByPath.has(path), `${path} must be policy-pinned`);
    return { path, source: readFileSync(resolve(ROOT, path), 'utf8') };
  });
}

test('composition path extractor retains KERN source and fragment entries', () => {
  const syntheticWorker = [
    'const COMPOSITION_PATHS = [',
    "  'examples/a.kern',",
    "  'examples/b.kernpart',",
    '];',
  ].join('\n');
  assert.deepEqual(compositionPaths(syntheticWorker), ['examples/a.kern', 'examples/b.kernpart']);
});

function semanticDiagnostics(source) {
  const parsed = parseDocumentWithDiagnostics(source);
  assert.deepEqual(parsed.diagnostics, [], 'fixture must parse without diagnostics');
  return validateSemantics(parsed.root);
}

test('every policy-pinned F4B composition fragment is semantic-validator clean', () => {
  const failures = f4bComposition().flatMap(({ path, source }) => semanticDiagnostics(source).map((diagnostic) => ({
    path,
    rule: diagnostic.rule,
    nodeType: diagnostic.nodeType,
    line: diagnostic.line,
    message: diagnostic.message,
  })));
  assert.deepEqual(failures, []);
});

test('source-validity oracle rejects an in-memory duplicate sibling for binding', () => {
  const forBinding = '    for name=index from=0 to=length\n';
  const fixture = f4bComposition().find(({ source }) => source.includes(forBinding));
  assert.ok(fixture, 'a policy-pinned F4B fragment must supply the mutation fixture');
  const firstLine = fixture.source.slice(0, fixture.source.indexOf(forBinding)).split('\n').length;
  const mutated = fixture.source.replace(
    '    let name=finalSegment value="Text.slice(moduleId, segmentStart, length)"',
    '    for name=index from=0 to=0\n      let name=duplicateCharacter value=""\n    let name=finalSegment value="Text.slice(moduleId, segmentStart, length)"',
  );
  assert.notEqual(mutated, fixture.source, 'mutation must add a sibling for binding');
  const diagnostics = semanticDiagnostics(mutated);
  assert.deepEqual(diagnostics.map(({ rule, nodeType, message }) => ({ rule, nodeType, message })), [{
    rule: 'duplicate-sibling-name',
    nodeType: 'for',
    message: `Duplicate 'for' named 'index' — first defined at line ${firstLine}`,
  }]);
});
