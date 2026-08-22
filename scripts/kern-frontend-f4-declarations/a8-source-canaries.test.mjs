import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  runA8SourceOwnership,
  scanHardcodedRootArguments,
  scanSemanticOwnership,
  scanShadowClosure,
  scanWorkerSemanticOwnership,
} from './a8-source-canaries.mjs';
import { ALL_COMPOSITION_PATHS } from './policy-validation.mjs';

const ROOT = new URL('../../', import.meta.url);
const compositionSource = ALL_COMPOSITION_PATHS
  .map((path) => readFileSync(new URL(path, ROOT), 'utf8'))
  .join('\n');

test('A8.1 semantic ownership scanner kills exact host classifiers and ignores inert text', () => {
  assert.deepEqual(scanSemanticOwnership(compositionSource), []);
  assert.deepEqual(scanSemanticOwnership([
    '# parseDocument(source)',
    'let name=parseDocumentCount value=0',
    'let name=note value="\\"literal parseLines(source)\\""',
    'let name=other value=0 # classifyHostAst(source)',
  ].join('\n')), []);

  for (const classifier of ['parseDocument', 'parseLines', 'bootstrapSemantic', 'classifyHostAst']) {
    const mutant = `let name=delegated value="${classifier}(source)"`;
    assert.deepEqual(scanSemanticOwnership(mutant), [classifier], classifier);
  }
  assert.deepEqual(scanSemanticOwnership('if cond="parseDocument(source)"'), ['parseDocument']);
  assert.deepEqual(
    scanSemanticOwnership('if cond=false\n  let name=delegated value="parseDocument(source)"'),
    ['parseDocument'],
    'an unreachable authored semantic call still violates ownership',
  );
  assert.deepEqual(
    scanSemanticOwnership('let "malformed prefix" name=x value="parseDocument(source)"'),
    ['parseDocument'],
    'a leading quoted token cannot hide a later authored value expression',
  );
});

test('A8.1 worker and root-argument scanners reject executable delegation and hardcoded caps', () => {
  assert.deepEqual(scanWorkerSemanticOwnership([
    '// parseDocument(source)',
    'const note = "parseLines(source)";',
    'const count = parseDocumentCount;',
  ].join('\n')), []);
  assert.deepEqual(scanWorkerSemanticOwnership('const result = parseDocument(source);'), ['parseDocument']);
  assert.deepEqual(
    scanHardcodedRootArguments('let name=result value="classifyf4available(moduleId, maxFacts)"'),
    [],
  );
  assert.deepEqual(
    scanHardcodedRootArguments('let name=result value="classifyf4available(moduleId, 999999)"'),
    ['classifyf4available[1]=999999'],
  );
});

test('A8.1 shadow-closure scanner kills dependency sites and ignores comments and ordinary paths', () => {
  assert.deepEqual(scanShadowClosure(compositionSource), []);
  assert.deepEqual(scanShadowClosure([
    '# use path="kern.frontend.fake-shadow.1"',
    'use path="./f4-declarations-helpers.kern"',
    'let name=note value="kern.frontend.fake-shadow.1"',
  ].join('\n')), []);

  assert.deepEqual(
    scanShadowClosure('use path="kern.frontend.keyword-handler-shadow.1"'),
    ['kern.frontend.keyword-handler-shadow.1'],
  );
  assert.deepEqual(
    scanShadowClosure('call name="kern.frontend.parser-shadow.2"'),
    ['kern.frontend.parser-shadow.2'],
  );
});

test('A8.1 reports F2 and F3 only after pristine and mutant controls execute', () => {
  assert.deepEqual(runA8SourceOwnership(compositionSource), [
    {
      id: 'A8-F2',
      control: 'passed',
      sentinel: 'reached',
      envelope: 'not-applicable',
      killedBy: 'source-ownership-rejection',
    },
    {
      id: 'A8-F3',
      control: 'passed',
      sentinel: 'reached',
      envelope: 'not-applicable',
      killedBy: 'source-closure-rejection',
    },
  ]);

  assert.throws(
    () => runA8SourceOwnership(`${compositionSource}\nlet name=x value="parseDocument(source)"`),
    /pristine|ownership|parseDocument/iu,
    'the report runner must execute the pristine ownership scan',
  );
  assert.throws(
    () => runA8SourceOwnership(`${compositionSource}\nuse path="kern.frontend.fake-shadow.1"`),
    /pristine|closure|fake-shadow/iu,
    'the report runner must execute the pristine closure scan',
  );
});
