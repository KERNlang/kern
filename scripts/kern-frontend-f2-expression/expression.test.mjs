import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { decodeExpression, loadPolicy } from './decoder.mjs';
import { assertProductionSource, loadComposition, runExpression } from './worker.mjs';

function parsed(source, options) {
  const result = runExpression(source, options);
  assert.equal(result.decoded.status, 'parsed', `${JSON.stringify(source)} must parse`);
  return result.decoded;
}

function rejected(source, code = 'FRONTEND_INVALID_EXPRESSION') {
  const result = runExpression(source);
  assert.equal(result.decoded.status, 'failure', `${JSON.stringify(source)} must reject`);
  assert.equal(result.decoded.diagnostic.code, code);
  assert.deepEqual(result.decoded.nodes, []);
  return result.decoded.diagnostic;
}

function root(source) {
  return parsed(source).root;
}

test('production F2 atoms and decoded text use the closed kind catalog', () => {
  assert.deepEqual(root('answer'), {
    children: [], endScalar: 6, flags: 0, id: 0, kindId: 0, payload: ['answer'], startScalar: 0, subtreeSize: 1,
  });
  assert.equal(root('null').kindId, 1);
  assert.equal(root('none').kindId, 1);
  assert.deepEqual(root('true').payload, ['true']);
  assert.deepEqual(root('42').payload, ['42']);
  assert.deepEqual(root('3.14').payload, ['3.14']);
  assert.deepEqual(root('"\\x41\\u0042\\u{1F600}"').payload, ['AB😀']);
});

test('production F2 unary, binary precedence, associativity, and grouping are exact', () => {
  const precedence = parsed('1 + 2 * 3');
  assert.deepEqual(precedence.nodes.map((node) => [node.kindId, node.payload, node.children]), [
    [3, ['1'], []],
    [3, ['2'], []],
    [3, ['3'], []],
    [13, ['*'], [1, 2]],
    [13, ['+'], [0, 3]],
  ]);
  const exponent = parsed('2 ** 3 ** 4');
  assert.deepEqual(exponent.root.children, [0, 3]);
  assert.deepEqual(exponent.nodes[3].children, [1, 2]);
  assert.equal(root('!answer').kindId, 14);
  assert.deepEqual(root('(1 + 2) * 3'), {
    children: [2, 3], endScalar: 11, flags: 0, id: 4, kindId: 13, payload: ['*'], startScalar: 0, subtreeSize: 5,
  });
  assert.deepEqual(rejected('-0'), { code: 'FRONTEND_INVALID_EXPRESSION', startScalar: 0, endScalar: 2 });
  assert.deepEqual(rejected('-0.00'), { code: 'FRONTEND_INVALID_EXPRESSION', startScalar: 0, endScalar: 5 });
});

test('production F2 covers every authenticated unary and binary operator', () => {
  for (const operator of ['!', '-', '+', '~', 'typeof', 'void']) {
    const tree = parsed(`${operator} value`);
    assert.equal(tree.root.kindId, 14, operator);
    assert.deepEqual(tree.root.payload, [operator], operator);
  }
  for (const operator of ['+', '-', '*', '/', '%', '**', '==', '!=', '===', '!==', '<', '<=', '>', '>=', 'instanceof', '&&', '||', '??', '&', '|', '^', '<<', '>>', '>>>']) {
    const tree = parsed(`left ${operator} right`);
    assert.equal(tree.root.kindId, 13, operator);
    assert.deepEqual(tree.root.payload, [operator], operator);
  }
  assert.deepEqual(root('a - b - c').children, [2, 3]);
  assert.deepEqual(root('a ** b ** c').children, [0, 3]);
  rejected('-a ** b');
  assert.equal(root('(-a) ** b').kindId, 13);
});

test('production F2 lists and records preserve source order without temporary nodes', () => {
  assert.deepEqual(root('[]'), {
    children: [], endScalar: 2, flags: 0, id: 0, kindId: 6, payload: [], startScalar: 0, subtreeSize: 1,
  });
  const list = parsed('[a, b,]');
  assert.equal(list.root.kindId, 6);
  assert.deepEqual(list.root.children, [0, 1]);
  assert.equal(list.nodes.length, 3);
  assert.deepEqual([list.root.startScalar, list.root.endScalar], [0, 7]);

  const record = parsed('{a, "b": 2, c}');
  assert.equal(record.root.kindId, 7);
  assert.deepEqual(record.root.payload, ['a', 'b', 'c']);
  assert.deepEqual(record.root.children, [0, 1, 2]);
  assert.equal(record.nodes.length, 4);
  assert.deepEqual([record.root.startScalar, record.root.endScalar], [0, 14]);
  rejected('{0: 1, "0": 2}');
  rejected('{"\\u0061": 1, a: 2}');
  rejected('{"a": 1, \'a\': 2}');
  rejected('{"\\x61": 1, a: 2}');
  rejected('{"\\u{61}": 1, a: 2}');
  rejected('{"\\uD83D\\uDE00": 1, "😀": 2}');
  assert.equal(root('{__proto__: 1, constructor: 2, prototype: 3}').kindId, 7);
  assert.equal(root('[a ? b : c, d]').kindId, 6);
  assert.equal(root('{x: a ? b : c, y: d}').kindId, 7);
});

test('production F2 postfix and optional forms set only the direct node flag', () => {
  assert.deepEqual(root('a.b'), {
    children: [0], endScalar: 3, flags: 0, id: 1, kindId: 8, payload: ['b'], startScalar: 0, subtreeSize: 2,
  });
  assert.equal(root('a?.undefined').flags, 1);
  assert.equal(root('a[b]').kindId, 9);
  assert.equal(root('a?.[b]').flags, 1);
  assert.deepEqual(root('a(b, c)').children, [0, 1, 2]);
  assert.equal(root('a?.(b)').flags, 1);
  const chain = parsed('a?.b.c');
  assert.equal(chain.nodes[1].flags, 1);
  assert.equal(chain.root.flags, 0);
  assert.equal(root('(a + b).c').kindId, 8);
  assert.equal(root('[a][0]').kindId, 9);
  assert.equal(root('new Map().x').kindId, 8);
  assert.equal(root('f()(x)').kindId, 10);
  assert.equal(root('a?.b[c]?.(d)').kindId, 10);
  assert.equal(root('f(a ? b : c, d)').kindId, 10);
  assert.equal(root('a[b ? c : d]').kindId, 9);
});

test('production F2 constructors enforce the closed names and arities', () => {
  assert.deepEqual(root('new Map()').payload, ['Map']);
  assert.deepEqual(root('new Error(problem)').children, [0]);
  assert.deepEqual([root('new Error(problem)').startScalar, root('new Error(problem)').endScalar], [0, 18]);
  rejected('new Map(value)');
  rejected('new Error()');
  rejected('new Date()');
});

test('production F2 lambdas are right associative and never emit parameter nodes', () => {
  const bare = parsed('a => b => c');
  assert.equal(bare.nodes.length, 3);
  assert.equal(bare.root.kindId, 12);
  assert.deepEqual(bare.root.payload, ['a']);
  assert.deepEqual(bare.nodes[1].payload, ['b']);
  assert.deepEqual(root('(a, b) => a').payload, ['a', 'b']);
  assert.deepEqual(root('() => value').payload, []);
  rejected('a + b => c');
  rejected('(a + b) => c');
  rejected('(a,) => a');
  rejected('(a, a) => a');
  rejected('a ? b : c => d');
  rejected('a => { b }');
  assert.equal(root('a => ({ b })').kindId, 12);
});

test('production F2 conditionals scope colons and associate right', () => {
  assert.deepEqual(root('a ? b : c').children, [0, 1, 2]);
  const nested = parsed('a ? b ? c : d : e');
  assert.equal(nested.root.kindId, 15);
  assert.equal(nested.nodes[4].kindId, 15);
  assert.deepEqual(nested.nodes.map((node) => [node.kindId, node.startScalar, node.endScalar]), [
    [0, 0, 1], [0, 4, 5], [0, 8, 9], [0, 12, 13], [15, 4, 13], [0, 16, 17], [15, 0, 17],
  ]);
  rejected('a ? (b : c) : d');
  rejected('a ? b');
});

test('production F2 rejects unparenthesized nullish/logical mixing only', () => {
  rejected('a ?? b + c || d');
  rejected('a && b ?? c');
  assert.equal(root('(a ?? b) || c').kindId, 13);
  assert.equal(root('a ?? (b || c)').kindId, 13);
});

test('production F2 rejects bootstrap-only and malformed source families atomically', () => {
  for (const source of ['', '   ', 'await', 'undefined', '01', '1.', '.1', '1e2', '/x/', '`x`', 'a = b', '[,a]', '{...a}', '"\\q"']) {
    rejected(source);
  }
  rejected('f<T>(x)');
  assert.equal(root('a > (b)').kindId, 13);
  const late = runExpression('a + b', { forceLateFailure: true }).decoded;
  assert.equal(late.status, 'failure');
  assert.equal(late.diagnostic.code, 'FORCED_LATE_FAILURE');
  assert.deepEqual(late.nodes, []);
});

test('production F2 enforces cheap equality and plus-one profile boundaries', () => {
  assert.equal(runExpression('a+b', { profileLimits: { maxTokens: 3 } }).decoded.status, 'parsed');
  assert.deepEqual(runExpression('a+b', { profileLimits: { maxTokens: 2 } }).decoded.diagnostic, {
    code: 'EXPRESSION_LIMIT', startScalar: 2, endScalar: 3,
  });
  assert.equal(runExpression('a+b', { profileLimits: { maxNodes: 3 } }).decoded.status, 'parsed');
  assert.equal(runExpression('a+b', { profileLimits: { maxNodes: 2 } }).decoded.diagnostic.code, 'EXPRESSION_LIMIT');
  const chunked = runExpression('a+b*c', { profileLimits: { nodesPerChunk: 2 } }).decoded;
  assert.equal(chunked.status, 'parsed');
  assert.equal(chunked.nodes.length, 5);
  assert.deepEqual(runExpression('abcd', { profileLimits: { maxSourceScalars: 3 } }).decoded.diagnostic, {
    code: 'SOURCE_LIMIT', startScalar: 0, endScalar: 4,
  });
  for (const [source, profileLimits, code] of [
    ['[[[a]]]', { maxNestingDepth: 2 }, 'EXPRESSION_LIMIT'],
    ['a+b', { maxChunks: 1, nodesPerChunk: 2 }, 'TRANSPORT_LIMIT'],
    ['a+b', { maxTapeScalars: 100 }, 'TRANSPORT_LIMIT'],
    ['a+b', { maxWorkSteps: 2 }, 'EXPRESSION_LIMIT'],
  ]) {
    const limited = runExpression(source, { profileLimits }).decoded;
    assert.equal(limited.status, 'failure', `${source} ${JSON.stringify(profileLimits)}`);
    assert.equal(limited.diagnostic.code, code);
    assert.deepEqual(limited.nodes, []);
  }
});

test('production F2 source authority cannot delegate parsing', () => {
  const loaded = loadComposition();
  for (const module of loaded.modules) assertProductionSource(module.source, module.path);
  for (const source of [
    'capability name=parse input=x',
    'fn name=x handler lang="kern" return value="parseExpression(x)"',
    'fn name=x handler lang="kern" return value="projectExpressionText(x)"',
    'fn name=x handler lang="typescript" code="return x"',
    'fn name=x handler lang="kern" return value="kern.frontend.any-shadow(x)"',
  ]) assert.throws(() => assertProductionSource(source, 'mutation.kern'));
  const parserSource = loaded.parserSource;
  assert.doesNotMatch(parserSource, /fn name=f2parse\b|f2parse\s*[(]/u);
  assert.doesNotMatch(loaded.composition, /__F2_(?:LEXER|PARSER)_BODY__|f2(?:lex|parse)\s*[(]/u);
  const helperNames = new Set((loaded.composition.match(/fn name=[A-Za-z_$][A-Za-z0-9_$]*/gu) ?? []).map((match) => match.slice(8)));
  const bareCalls = [...loaded.composition.matchAll(/(?<![.])\b([A-Za-z_$][A-Za-z0-9_$]*)[(]/gu)].map((match) => match[1]);
  for (const name of bareCalls) {
    assert.ok(helperNames.has(name) || ['Map', 'String'].includes(name), `unowned bare call ${name}`);
  }
  for (const namespace of loaded.composition.matchAll(/\b([A-Z][A-Za-z0-9_$]*)[.][A-Za-z_$][A-Za-z0-9_$]*[(]/gu)) {
    assert.ok(['KernInternal', 'List', 'Map', 'Text'].includes(namespace[1]), `unowned namespace ${namespace[1]}`);
  }
});

test('production F2 decoder kills internal span, child-order, and duplicate-key mutations', () => {
  const policy = loadPolicy();
  const binary = runExpression('a+b');
  const widenedAtom = [...binary.fields];
  widenedAtom[7] = widenedAtom[7].replace('f3,1:1', 'f3,1:2');
  assert.throws(() => decodeExpression(widenedAtom, 'a+b', policy), /span/u);

  const reversedChildren = [...binary.fields];
  reversedChildren[7] = reversedChildren[7].replace('f7,8:i1:0i1:1', 'f7,8:i1:1i1:0');
  assert.throws(() => decodeExpression(reversedChildren, 'a+b', policy));

  const record = runExpression('{a: 1, b: 2}');
  assert.equal(record.decoded.status, 'parsed');
  const duplicateKey = [...record.fields];
  duplicateKey[7] = duplicateKey[7].replace('f6,8:i1:ai1:b', 'f6,8:i1:ai1:a');
  assert.throws(() => decodeExpression(duplicateKey, '{a: 1, b: 2}', policy), /duplicate/u);
});
