import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { __test, runProjection } from './worker.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const kern = (name) => readFileSync(resolve(ROOT, 'examples/kern-frontend', name), 'utf8');
const functionBody = (source, name) => {
  const start = source.indexOf(`fn name=${name} `);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf('\nfn name=', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
};
const occurrences = (source, pattern) => source.match(pattern)?.length ?? 0;
const moduleCase = (source, moduleId = 'case.kern') => [{ moduleId, source }];

test('F5-A3-E1 expression tapes are adopted once at the expression root', () => {
  const source = kern('f5-expression-projection.kern');
  assert.match(source, /let name=expressionWork value="f5rowcodecwork\(kindTape, kindTexts\) \+ f5rowcodecwork\(flagTape, flagTexts\) \+ f5rowcodecwork\(payloadTape, payloadTapes\) \+ f5rowcodecwork\(childTape, childTapes\)"/u);
  assert.match(source, /let name=recordEntryWork value=0/u);
  assert.doesNotMatch(source, /let name=recordEntryWork value=expressionWork/u);
  assert.match(source, /let name=rootWork value="nodeReadWork \+ \(index == kindIds\.length - 1 \? expressionWork : 0\)"/u);
});

test('F5-A3-E2 record and list limited children never re-adopt child work', () => {
  const source = kern('f5-ordinal-composites.kern');
  for (const name of ['f5recordordinals', 'f5listordinals']) {
    const body = functionBody(source, name);
    assert.match(body, /if cond="firstLimit != \\"\\""\s+return value="f5resultfailure\(\\"1\\", \\"F5_LIMIT\\", work\)"/u, name);
    assert.doesNotMatch(body, /work \+ f5uint\(limited\[3\]\)/u, name);
  }
});

test('F5-A3-E3 successful source sorting is adopted before source ordinals are consumed', () => {
  const body = functionBody(kern('f5-module-projection.kern'), 'f5projectmodules');
  assert.match(body, /let name=sortedSources value="f5chargedsort\([^\n]+\)"[\s\S]*assign target=moduleWork value="f5uint\(List\.index\(sortedSources, sourceEntries\.length \+ 1\)\)"[\s\S]*for name=sourceIndex/u);
});

test('F5-A3-E4 every binding and symbol row decode has exact codec ownership', () => {
  const body = functionBody(kern('f5-module-projection.kern'), 'f5projectmodules');
  assert.equal(occurrences(body, /f5rowread\(/gu), occurrences(body, /f5rowcodecwork\(/gu),
    'module row reads and codec charges must be one-for-one');
});

test('F5-A3-E5 module failures use one cumulative ledger across prior modules and siblings', () => {
  const body = functionBody(kern('f5-module-projection.kern'), 'f5projectmodules');
  assert.match(body, /let name=moduleWork value=/u);
  assert.doesNotMatch(body, /let name=orderingWork value=/u);
  assert.doesNotMatch(body, /return value="(?:\\"\\"|\\"__F5_[A-Z_]+__\\")"/u);
});

test('F5-A3-E6 ordinal dry runs prospectively price every post-gate decode', () => {
  const source = kern('f5-ordinal-composites.kern');
  for (const name of ['f5recordordinals', 'f5listordinals']) {
    const body = functionBody(source, name);
    const gate = body.indexOf('f5resultgate(');
    const before = body.slice(0, gate);
    const after = body.slice(gate);
    assert.equal(occurrences(after, /f5rowread\(/gu), occurrences(before, /name=copyRowReadWork/gu), name);
    assert.equal(occurrences(after, /f5resultread\(/gu), occurrences(before, /name=copyResultReadWork/gu), name);
    assert.doesNotMatch(after, /assign target=work/u, name);
  }
});

test('F5-A3-E7 tree projection returns status, work, and roots without length proxies', () => {
  const tree = functionBody(kern('f5-tree-projection.kern'), 'f5projecttree');
  const main = kern('f5-projection-main.kern');
  assert.match(tree, /result\.push\(\\"0\\"\)[\s\S]*result\.push\(String\(work\)\)/u);
  assert.doesNotMatch(tree, /return value="\[\\"__F5_|return value="\[\]"/u);
  assert.doesNotMatch(main, /f5worklength\(/u);
});

test('F5-A3-E8 corrected work gates retain drift precedence and atomic limits', () => {
  const tree = functionBody(kern('f5-tree-projection.kern'), 'f5projecttree');
  assert.doesNotMatch(tree, /return value="(?:\[\]|\[\\"__F5_[A-Z_]+__\\"\])"/u,
    'tree drift must retain cumulative work before any simultaneous work gate');
  const modules = moduleCase('fn name=main export=true\n  handler lang=kern\n    return value="{a: 1, b: 2}"\n');
  const baseline = runProjection(modules);
  const exact = __test.runProjectionWithProfileLimits(modules, { maxWorkSteps: baseline.receipt.workSteps });
  const under = __test.runProjectionWithProfileLimits(modules, { maxWorkSteps: baseline.receipt.workSteps - 1 });
  assert.equal(exact.receipt.status, 'projected');
  assert.equal(under.receipt.diagnostics[0].code, 'F5_LIMIT');
  assert.equal(under.bytes, null);
  assert.equal(under.receipt.workSteps, baseline.receipt.workSteps);
});

test('F5-A3-E9 ownership source closure rejects known double-charge and workless forms', () => {
  const metric = [functionBody(kern('f5-expression-projection.kern'), 'f5expression'),
    functionBody(kern('f5-tree-projection.kern'), 'f5projecttree'),
    functionBody(kern('f5-module-projection.kern'), 'f5projectmodules')].join('\n');
  const all = `${metric}\n${kern('f5-projection-main.kern')}\n${kern('f5-ordinal-composites.kern')}`;
  assert.doesNotMatch(kern('f5-ordinal-composites.kern'), /work \+ f5uint\(limited\[3\]\)/u);
  assert.doesNotMatch(metric, /return value="(?:\\"\\"|\[\]|\[\\"__F5_[A-Z_]+__\\"\])"/u);
  assert.doesNotMatch(all, /List\.join\(/u);
  assert.doesNotMatch(all, /let name=(?:sorted|ordered)(?:Payloads|Entries|Values) value="\[\]"/u);
});

test('F5-A3-RED completed but unreturned work has an explicit failure owner', () => {
  const expression = functionBody(kern('f5-expression-projection.kern'), 'f5expression');
  const tree = functionBody(kern('f5-tree-projection.kern'), 'f5projecttree');
  const modules = functionBody(kern('f5-module-projection.kern'), 'f5projectmodules');
  assert.match(expression, /let name=completedExpressionWork value=0/u,
    'an early expression failure must retain completed sibling construction work');
  assert.match(tree, /let name=completedTreeWork value=0/u,
    'an early tree failure must retain completed node construction work not returned as roots');
  assert.match(modules, /let name=currentModuleWork value=0/u,
    'an early module failure must retain successful current-module sibling frames');
  assert.match(modules, /assign target=currentModuleWork value=0/u,
    'current-module failure ownership resets only after the module entry adopts its children');
});

test('F5-A3-RED every physical ordinal decode is priced before the gate', () => {
  const source = kern('f5-ordinal-composites.kern');
  for (const name of ['f5recordordinals', 'f5listordinals']) {
    const body = functionBody(source, name);
    const gate = body.indexOf('f5resultgate(');
    const before = body.slice(0, gate);
    const after = body.slice(gate);
    const rowReads = occurrences(body, /f5rowread\(/gu);
    const resultReads = occurrences(body, /f5resultread\(/gu);
    assert.equal(occurrences(before, /f5rowcodecwork\(/gu), rowReads, `${name} row-read pricing`);
    assert.equal(occurrences(before, /name=(?:validation|measure|copy)ResultReadWork/gu), resultReads,
      `${name} result-read pricing`);
    assert.ok(occurrences(after, /f5rowread\(/gu) > 0, `${name} exercises a post-gate copy decode`);
  }
});
