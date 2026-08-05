import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const evidencePath = 'packages/core/tests/kern-kir-runner-composed-evidence.test.ts';
const fixturePath = 'packages/core/tests/kern-kir-runner-composed-fixtures.ts';
const runtimeImportPolicy = Object.freeze({
  [evidencePath]: [
    '../src/kir-structural/module-canonical.js:encodeModuleKir:encodeModuleKir',
    '../src/runtime-envelope/kir-handler.js:executeInternalRuntimeKirHandlerAsync:executeInternalRuntimeKirHandlerAsync',
    '../src/runtime-envelope/kir-handler.js:executeInternalRuntimeKirHandlerSync:executeInternalRuntimeKirHandlerSync',
    '../src/runtime-envelope/normalize.js:encodeInternalRuntimeEnvelope:encodeInternalRuntimeEnvelope',
    './kern-kir-runner-composed-fixtures.js:COMPOSED_RUNNER_ORACLES:COMPOSED_RUNNER_ORACLES',
    './kern-kir-runner-composed-fixtures.js:COMPOSED_RUNNER_WITNESSES:COMPOSED_RUNNER_WITNESSES',
    './kern-kir-runner-composed-fixtures.js:buildComposedRunnerFixture:buildComposedRunnerFixture',
  ],
  [fixturePath]: [
    '../src/ir/semantics/index.js:makeEnv:makeEnv',
    '../src/runtime-envelope/types.js:INTERNAL_RUNTIME_ENVELOPE_FORMAT:INTERNAL_RUNTIME_ENVELOPE_FORMAT',
  ],
});
const protectedBindings = new Set([
  'encodeInternalRuntimeEnvelope',
  'encodeModuleKir',
  'executeInternalRuntimeKirHandlerAsync',
  'executeInternalRuntimeKirHandlerSync',
]);

function parse(source, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(sourceFile.parseDiagnostics.length, 0, `${sourcePath} must parse`);
  return sourceFile;
}

function runtimeImports(sourceFile) {
  const imports = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    const source = statement.moduleSpecifier.text;
    if (!clause) {
      imports.push(`${source}:side-effect:`);
      continue;
    }
    if (clause.isTypeOnly) continue;
    if (clause.name) imports.push(`${source}:default:${clause.name.text}`);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      imports.push(`${source}:*:${clause.namedBindings.name.text}`);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly) continue;
        imports.push(`${source}:${element.propertyName?.text ?? element.name.text}:${element.name.text}`);
      }
    }
  }
  return imports.sort();
}

function assertNoDynamicLoadOrShadow(sourceFile) {
  function bindingNames(name) {
    if (ts.isIdentifier(name)) return [name.text];
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      return name.elements.flatMap((element) => ts.isBindingElement(element) ? bindingNames(element.name) : []);
    }
    return [];
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      assert.equal(node.expression.kind === ts.SyntaxKind.ImportKeyword, false, 'dynamic import bypasses the evidence boundary');
      assert.equal(ts.isIdentifier(node.expression) && node.expression.text === 'require', false, 'require bypasses the evidence boundary');
    }
    if (!ts.isImportDeclaration(node)) {
      const names = [];
      if (ts.isVariableDeclaration(node)) names.push(...bindingNames(node.name));
      if (ts.isParameter(node)) names.push(...bindingNames(node.name));
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.push(node.name.text);
      for (const name of names) assert.equal(protectedBindings.has(name), false, `${name} must not be shadowed`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function initializer(sourceFile, name) {
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      assert.equal(result, undefined, `${name} must have one declaration`);
      assert.ok(
        ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0,
        `${name} must remain const`,
      );
      result = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(result, `${name} must be initialized`);
  return result;
}

function unwrap(node) {
  if (ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node)) return unwrap(node.expression);
  return node;
}

function assertCall(node, callee, firstArgument) {
  const call = unwrap(node);
  assert.ok(ts.isCallExpression(call), `${callee} result must initialize the bound value`);
  assert.ok(ts.isIdentifier(call.expression) && call.expression.text === callee, `bound value must come from ${callee}`);
  if (firstArgument) {
    assert.ok(ts.isIdentifier(call.arguments[0]) && call.arguments[0].text === firstArgument, `${callee} must consume ${firstArgument}`);
  }
}

function assertExpectedOracle(node) {
  assert.ok(ts.isElementAccessExpression(node), 'expected must come from the composed runner oracle table');
  assert.ok(
    ts.isIdentifier(node.expression) && node.expression.text === 'COMPOSED_RUNNER_ORACLES',
    'expected must come from COMPOSED_RUNNER_ORACLES',
  );
  assert.ok(
    ts.isPropertyAccessExpression(node.argumentExpression) &&
      ts.isIdentifier(node.argumentExpression.expression) &&
      node.argumentExpression.expression.text === 'witness' &&
      node.argumentExpression.name.text === 'oracleId',
    'expected must use witness.oracleId',
  );
}

function compact(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/gu, '').replace(/,\)/gu, ')');
}

function assertExpectation(sourceFile, exactText) {
  let found = false;
  function visit(node) {
    if (ts.isCallExpression(node) && compact(node, sourceFile) === exactText) found = true;
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.equal(found, true, `missing bound assertion ${exactText}`);
}

function assertFullWitnessRegistration(sourceFile) {
  const registrations = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'test' &&
      node.expression.name.text === 'each'
    ) {
      registrations.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.equal(registrations.length, 1, 'evidence must register exactly one full witness table');
  const [registration] = registrations;
  assert.equal(registration.arguments.length, 1, 'test.each must receive only the full witness catalog');
  assert.ok(
    ts.isIdentifier(registration.arguments[0]) && registration.arguments[0].text === 'COMPOSED_RUNNER_WITNESSES',
    'test.each must consume the full witness catalog directly',
  );
}

export function assertComposedEvidenceBoundary(readText = (path) => readFileSync(path, 'utf8')) {
  const sourceFiles = new Map([
    [evidencePath, parse(readText(evidencePath), evidencePath)],
    [fixturePath, parse(readText(fixturePath), fixturePath)],
  ]);
  for (const [path, sourceFile] of sourceFiles) {
    assert.deepEqual(runtimeImports(sourceFile), [...runtimeImportPolicy[path]].sort(), `${path} runtime imports drifted`);
    assertNoDynamicLoadOrShadow(sourceFile);
  }

  const evidence = sourceFiles.get(evidencePath);
  assertFullWitnessRegistration(evidence);
  assertExpectedOracle(initializer(evidence, 'expected'));
  assertCall(initializer(evidence, 'encoded'), 'encodeModuleKir');
  assertCall(initializer(evidence, 'sync'), 'executeInternalRuntimeKirHandlerSync', 'encoded');
  assertCall(initializer(evidence, 'asyncEnvelope'), 'executeInternalRuntimeKirHandlerAsync', 'encoded');
  assertExpectation(evidence, 'expect(sync).toEqual(expected)');
  assertExpectation(evidence, 'expect(asyncEnvelope).toEqual(expected)');
  assertExpectation(
    evidence,
    'expect(encodeInternalRuntimeEnvelope(asyncEnvelope,runtimeLimits)).toEqual(encodeInternalRuntimeEnvelope(sync,runtimeLimits))',
  );
}

test('composed runner evidence closes runtime imports and binds encoder, handlers, and exact envelope assertions', () => {
  assert.doesNotThrow(() => assertComposedEvidenceBoundary());
});

test('composed runner evidence rejects every alternate runtime-value import path', () => {
  const evidence = readFileSync(evidencePath, 'utf8');
  for (const bypass of [
    '../src/parser.js',
    '../src/runner.js',
    '../src/runtime-handler.js',
    '../src/runtime-envelope/execute.js',
    '../src/runtime-envelope/handler-entry.js',
    '../src/runtime-envelope/internal-engine.js',
    '../src/runtime-envelope/internal-legacy-engine.js',
    '../src/runtime-envelope/source-handler.js',
  ]) {
    assert.throws(
      () => assertComposedEvidenceBoundary(
        (path) => path === evidencePath ? `${evidence}\nimport '${bypass}';\n` : readFileSync(path, 'utf8'),
      ),
      /runtime imports drifted/u,
    );
  }
});

test('composed runner evidence cannot register an empty or filtered witness subset', () => {
  const evidence = readFileSync(evidencePath, 'utf8');
  for (const selection of ['COMPOSED_RUNNER_WITNESSES.slice(0, 0)', 'COMPOSED_RUNNER_WITNESSES.filter(() => false)']) {
    assert.throws(
      () => assertComposedEvidenceBoundary(
        (path) => path === evidencePath
          ? evidence.replace('test.each(COMPOSED_RUNNER_WITNESSES)', `test.each(${selection})`)
          : readFileSync(path, 'utf8'),
      ),
      /full witness catalog directly/u,
    );
  }
});

test('decorative production calls cannot replace the bound encoder or handler dataflow', () => {
  const evidence = readFileSync(evidencePath, 'utf8');
  const mutations = [
    evidence.replace(
      'const encoded = encodeModuleKir(moduleFixture(fixture.body, fixture.returns), kirLimits);',
      'encodeModuleKir(moduleFixture(fixture.body, fixture.returns), kirLimits);\n    const encoded = new Uint8Array();',
    ),
    evidence.replace(
      'const sync = executeInternalRuntimeKirHandlerSync(encoded, identity, [], fixture.syncHost, enabled);',
      'executeInternalRuntimeKirHandlerSync(encoded, identity, [], fixture.syncHost, enabled);\n    const sync = expected;',
    ),
    evidence.replace('expect(sync).toEqual(expected);', 'expect(expected).toEqual(expected);'),
    evidence.replace(
      'const expected = COMPOSED_RUNNER_ORACLES[witness.oracleId];',
      'const expected = buildComposedRunnerFixture(witness);',
    ),
    evidence
      .replace('const sync = executeInternalRuntimeKirHandlerSync', 'let sync = executeInternalRuntimeKirHandlerSync')
      .replace('const asyncEnvelope = await executeInternalRuntimeKirHandlerAsync', 'let asyncEnvelope = await executeInternalRuntimeKirHandlerAsync')
      .replace('expect(sync).toEqual(expected);', 'sync = expected;\n    asyncEnvelope = expected;\n    expect(sync).toEqual(expected);'),
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => assertComposedEvidenceBoundary(
        (path) => path === evidencePath ? mutation : readFileSync(path, 'utf8'),
      ),
      /bound value|bound assertion|must remain const|expected must/u,
    );
  }
});

test('production bindings cannot be shadowed or loaded dynamically', () => {
  const evidence = readFileSync(evidencePath, 'utf8');
  for (const addition of [
    'function shadow(encodeModuleKir) { return encodeModuleKir; }',
    'function shadow(value) { const { encodeModuleKir } = value; return encodeModuleKir; }',
    "async function load() { return import('../src/runtime-envelope/execute.js'); }",
    "const load = () => require('../src/runtime-envelope/execute.js');",
  ]) {
    assert.throws(
      () => assertComposedEvidenceBoundary(
        (path) => path === evidencePath ? `${evidence}\n${addition}\n` : readFileSync(path, 'utf8'),
      ),
      /must not be shadowed|bypasses the evidence boundary/u,
    );
  }
});
