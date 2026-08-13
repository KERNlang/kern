import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { decodeCanonicalValue, encodeCanonicalValue } from '../../packages/core/dist/canonical-value/canonical.js';
import { decodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { validateSemanticExpectations } from './semantic-expectations.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const LEDGER_PATH = resolve(HERE, 'closure-ledger.json');
const GOLDENS_PATH = resolve(HERE, 'static-goldens.json');
const PACKAGE_PATH = resolve(ROOT, 'package.json');
const SEMANTIC_EXPECTATIONS_PATH = resolve(HERE, 'semantic-expectations.json');
const BASELINE = 'fa11d52d841508ed0ad0d5c2b9a62a00c6eb4970';
const GOLDEN_PATH = 'scripts/kern-frontend-closure/static-goldens.json';

const LIMITS = Object.freeze({
  maxBytes: 262_144,
  maxCollectionLength: 1_024,
  maxDecimalChars: 520,
  maxDepth: 64,
  maxFractionDigits: 256,
  maxIntegerDigits: 256,
  maxMapEntries: 64,
  maxNodes: 4_096,
  maxRecordFields: 512,
  maxStringBytes: 8_192,
});

const FAMILY_FIELDS = Object.freeze([
  'id',
  'lexical',
  'parse',
  'attachment',
  'propertyDefault',
  'kir',
  'malformedDiagnostic',
]);
const AUTHORITY_PATHS = Object.freeze({
  'builtin-node-types': 'scripts/kern-frontend-builtin-node-type-attestation/catalog.json',
  'structural-constitution': 'scripts/kir-structural/constitution.json',
  'structural-witness-ledger': 'scripts/kir-v1/coverage-witness-ledger.json',
  'kir-eligibility': 'scripts/kir-v1/eligibility.json',
  'expression-contract': 'packages/core/src/kir-structural/expression.ts',
  'module-contract': 'packages/core/src/kir-structural/module-types.ts',
  'parser-diagnostic-types': 'packages/core/src/types.ts',
  'parser-diagnostics': 'packages/core/src/parser-diagnostics.ts',
});
const AUTHORITY_IDS = Object.freeze(Object.keys(AUTHORITY_PATHS));
const FAMILY_IDS = Object.freeze([
  'physical-framing',
  'trivia-comments-quotes',
  'expressions',
  'logical-lines',
  'indentation-tree',
  'decorators',
  'raw-and-multiline',
  'declarations-properties-defaults',
  'modules-imports-exports',
]);
const PHASES = Object.freeze([
  'F0-surface-closure',
  'F1-document-scan',
  'F2-expressions',
  'F3-lines-tree',
  'F4-declarations-modules',
  'F5-projection',
  'F6-adversarial-closure',
  'F7-terminal-promotion',
]);
const FAILURE_CODES = Object.freeze({
  'excluded-raw-block': ['FRONTEND_EXCLUDED_RAW_BLOCK'],
  'dangling-decorator-and-indent-jump': ['DROPPED_DECORATOR', 'INDENT_JUMP'],
  'excluded-host-expression': ['FRONTEND_EXCLUDED_HOST_EXPRESSION'],
  'excluded-host-type': ['FRONTEND_EXCLUDED_HOST_TYPE'],
  'invalid-expression': ['FRONTEND_INVALID_EXPRESSION'],
  'unsupported-module-root': ['FRONTEND_UNSUPPORTED_MODULE_ROOT'],
});
const FEATURE_PATTERNS = Object.freeze({
  'two-modules': [
    /^fn name=double export=true$/mu,
    /^    return value="value \* 2"$/mu,
    /^fn name=main export=true$/mu,
  ],
  'use-from-binding': [/^use path="\.\/lib\/symbols"$/mu, /^  from name=double kind=fn as=twice export=true$/mu],
  'decorator-attachment': [/^@trace\("main"\)$/mu],
  'indented-handler': [/^  param name=value type=number$/mu, /^  handler lang=kern$/mu],
  'precedence-expression': [/twice\(1 \+ 2 \* 3\)/u],
  'comment-trivia': [/^# static frontend golden$/mu],
});

function fail(message) {
  throw new Error(`KERN frontend closure: ${message}`);
}

function exact(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${path} fields must be ${keys.join(',')}`);
}

function uniqueStrings(values, path) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || value.length === 0)) {
    fail(`${path} must contain non-empty strings`);
  }
  if (new Set(values).size !== values.length) fail(`${path} must be unique`);
}

function distribution(rows, key) {
  return Object.fromEntries(
    [...rows.reduce((counts, row) => counts.set(row[key], (counts.get(row[key]) ?? 0) + 1), new Map())]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

function readRegular(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${relative(ROOT, path)} must be a regular file`);
  const real = realpathSync(path);
  const rel = relative(realpathSync(ROOT), real);
  if (rel.startsWith('..') || rel === '') fail(`${relative(ROOT, path)} escapes the repository`);
  return readFileSync(real);
}

function parseJson(bytes, path) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(`${path} must be valid JSON`);
  }
}

function sourceInitializer(source, declaration) {
  const sourceFile = ts.createSourceFile('authority.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === declaration) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  while (initializer && (ts.isAsExpression(initializer) || ts.isParenthesizedExpression(initializer))) {
    initializer = initializer.expression;
  }
  if (!initializer) fail(`cannot extract ${declaration}`);
  return initializer;
}

function sourceArray(source, declaration) {
  let initializer = sourceInitializer(source, declaration);
  if (initializer && ts.isNewExpression(initializer)) initializer = initializer.arguments?.[0];
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) fail(`cannot extract ${declaration}`);
  const values = initializer.elements.map((element) => (
    ts.isStringLiteralLike(element) ? element.text : fail(`${declaration} must contain only string literals`)
  ));
  return values;
}

function parserDiagnosticCodes(source) {
  const initializer = sourceInitializer(source, 'DIAGNOSTIC_SUGGESTIONS');
  if (!ts.isObjectLiteralExpression(initializer)) fail('cannot extract parser diagnostic catalog');
  return initializer.properties.map((property) => {
    if (!ts.isPropertyAssignment(property) || !property.name) fail('parser diagnostic catalog must be an object');
    if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) return property.name.text;
    return fail('parser diagnostic keys must be static');
  });
}

function parserDiagnosticTypeCodes(source) {
  const sourceFile = ts.createSourceFile('types.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let typeNode;
  function visit(node) {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'ParseErrorCode') typeNode = node.type;
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!typeNode || !ts.isUnionTypeNode(typeNode)) fail('cannot extract ParseErrorCode');
  return typeNode.types.map((member) => {
    if (ts.isLiteralTypeNode(member) && ts.isStringLiteralLike(member.literal)) return member.literal.text;
    return fail('ParseErrorCode must contain only string literals');
  });
}

function verifyAuthority(authority, index, authorityBytes) {
  exact(authority, ['id', 'path', 'sha256', 'rows'], `ledger.authorities[${index}]`);
  if (authority.id !== AUTHORITY_IDS[index]) fail(`authority ${index} order drifted`);
  if (authority.path !== AUTHORITY_PATHS[authority.id]) fail(`authority ${authority.id} path drifted`);
  if (!/^[a-f0-9]{64}$/u.test(authority.sha256)) fail(`authority ${authority.id} digest is invalid`);
  if (!Number.isSafeInteger(authority.rows) || authority.rows <= 0) fail(`authority ${authority.id} rows are invalid`);
  const bytes = authorityBytes.get(authority.id);
  if (!Buffer.isBuffer(bytes)) fail(`authority ${authority.id} is unavailable`);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== authority.sha256) fail(`authority ${authority.id} digest drifted`);
}

function authorityRows(ledger, authorityId) {
  const authority = ledger.authorities.find(({ id }) => id === authorityId);
  if (!authority) fail(`authority ${authorityId} is unavailable`);
  return authority.rows;
}

function verifySpan(diagnostic, source, path) {
  const values = [diagnostic.line, diagnostic.col, diagnostic.endLine, diagnostic.endCol];
  if (!values.every(Number.isSafeInteger)) fail(`${path} span is invalid`);
  const lines = source.split('\n');
  if (
    diagnostic.line < 1 ||
    diagnostic.endLine < diagnostic.line ||
    diagnostic.endLine > lines.length ||
    diagnostic.col < 1 ||
    diagnostic.col > lines[diagnostic.line - 1].length + 1 ||
    diagnostic.endCol < 1 ||
    diagnostic.endCol > lines[diagnostic.endLine - 1].length + 1 ||
    (diagnostic.line === diagnostic.endLine && diagnostic.endCol < diagnostic.col)
  ) fail(`${path} span is out of range`);
}

function validateGoldens(
  goldens,
  diagnosticCodes,
  frontendFailureCodes,
  goldenBytes,
  goldenContract,
  semanticExpectations,
  semanticExpectationsBytes,
) {
  exact(goldenContract, ['path', 'sha256', 'canonicalSha256'], 'ledger.goldens');
  if (goldenContract.path !== GOLDEN_PATH) fail('golden path drifted');
  if (createHash('sha256').update(goldenBytes).digest('hex') !== goldenContract.sha256) fail('golden digest drifted');
  if (JSON.stringify(parseJson(goldenBytes, GOLDEN_PATH)) !== JSON.stringify(goldens)) fail('golden payload drifted');
  exact(goldens, ['schemaVersion', 'format', 'valid', 'failures'], 'goldens');
  if (goldens.schemaVersion !== 1 || goldens.format !== 'kern.frontend.static-goldens.1') {
    fail('unsupported static golden format');
  }
  exact(goldens.valid, ['id', 'modules', 'expectedCanonicalBase64', 'requiredFeatures'], 'goldens.valid');
  if (!Array.isArray(goldens.valid.modules) || goldens.valid.modules.length !== 2) {
    fail('valid golden must contain exactly two modules');
  }
  const moduleIds = goldens.valid.modules.map((module, index) => {
    exact(module, ['id', 'source'], `goldens.valid.modules[${index}]`);
    if (typeof module.source !== 'string' || !module.source.endsWith('\n')) fail(`golden module ${index} source is invalid`);
    return module.id;
  });
  if (new Set(moduleIds).size !== moduleIds.length) fail('golden module ids must be unique');
  uniqueStrings(goldens.valid.requiredFeatures, 'goldens.valid.requiredFeatures');
  const sourceText = goldens.valid.modules.map(({ source }) => source).join('\n');
  for (const feature of ['two-modules', 'use-from-binding', 'decorator-attachment', 'indented-handler', 'precedence-expression', 'comment-trivia']) {
    if (!goldens.valid.requiredFeatures.includes(feature)) fail(`valid golden is missing ${feature}`);
    if (FEATURE_PATTERNS[feature].some((pattern) => !pattern.test(sourceText))) {
      fail(`valid golden source is missing ${feature}`);
    }
  }
  if (goldens.valid.modules.some((module) => /PENDING_F0|parseInternal|parseDocument/u.test(module.source))) {
    fail('valid golden contains a placeholder or bootstrap parser reference');
  }
  const bytes = Buffer.from(goldens.valid.expectedCanonicalBase64, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== goldens.valid.expectedCanonicalBase64) {
    fail('valid golden base64 is non-canonical');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== goldenContract.canonicalSha256) {
    fail('valid golden canonical digest drifted');
  }
  const canonicalValue = decodeCanonicalValue(bytes, LIMITS);
  if (!Buffer.from(encodeCanonicalValue(canonicalValue, LIMITS)).equals(bytes)) fail('valid golden bytes do not round-trip');
  const artifact = decodeModuleKir(bytes, LIMITS);
  if (artifact.modules.map((module) => module.id).join(',') !== moduleIds.join(',')) {
    fail('valid golden module identity drifted');
  }
  if (!Array.isArray(goldens.failures) || goldens.failures.length !== Object.keys(FAILURE_CODES).length) {
    fail(`exactly ${Object.keys(FAILURE_CODES).length} failure goldens are required`);
  }
  const failureIds = new Set();
  for (const [index, fixture] of goldens.failures.entries()) {
    exact(fixture, ['id', 'moduleId', 'source', 'diagnostics'], `goldens.failures[${index}]`);
    if (failureIds.has(fixture.id)) fail(`duplicate failure golden ${fixture.id}`);
    failureIds.add(fixture.id);
    if (!Object.hasOwn(FAILURE_CODES, fixture.id)) fail(`unknown failure golden ${fixture.id}`);
    if (typeof fixture.source !== 'string' || !fixture.source.endsWith('\n')) fail(`failure golden ${fixture.id} source is invalid`);
    if (!Array.isArray(fixture.diagnostics) || fixture.diagnostics.length === 0) fail(`failure golden ${fixture.id} needs diagnostics`);
    for (const [diagnosticIndex, diagnostic] of fixture.diagnostics.entries()) {
      exact(diagnostic, ['code', 'severity', 'line', 'col', 'endLine', 'endCol'], `goldens.failures[${index}].diagnostics[${diagnosticIndex}]`);
      if (!['error', 'warning', 'info'].includes(diagnostic.severity)) fail(`diagnostic ${diagnostic.code} severity is invalid`);
      if (![...frontendFailureCodes, ...diagnosticCodes].includes(diagnostic.code)) {
        fail(`diagnostic ${diagnostic.code} is outside the closure`);
      }
      verifySpan(diagnostic, fixture.source, `diagnostic ${diagnostic.code}`);
    }
    if (JSON.stringify(fixture.diagnostics.map(({ code }) => code)) !== JSON.stringify(FAILURE_CODES[fixture.id])) {
      fail(`failure golden ${fixture.id} diagnostic order drifted`);
    }
  }
  if (JSON.stringify([...failureIds]) !== JSON.stringify(Object.keys(FAILURE_CODES))) {
    fail('failure golden order drifted');
  }
  validateSemanticExpectations({
    artifact,
    expectations: semanticExpectations,
    expectationsBytes: semanticExpectationsBytes,
    goldens,
  });
  return { artifactBytes: bytes.length, failures: goldens.failures.length, modules: moduleIds.length };
}

export function validateFrontendClosure({
  ledger,
  goldens,
  goldenBytes,
  packageJson,
  authorityBytes,
  semanticExpectations,
  semanticExpectationsBytes,
}) {
  exact(
    ledger,
    [
      'schemaVersion', 'format', 'status', 'baseline', 'terminalGate', 'authorities', 'nodeClosure',
      'propertyClosure', 'expressionClosure', 'moduleClosure', 'diagnosticCodes', 'frontendFailureCodes',
      'families', 'phases', 'goldens',
    ],
    'ledger',
  );
  if (ledger.schemaVersion !== 1 || ledger.format !== 'kern.frontend.surface-closure.1') fail('unsupported ledger format');
  if (ledger.status !== 'non-promoting-contract') fail('F0 must remain non-promoting');
  if (ledger.baseline !== BASELINE) fail('baseline drifted');
  exact(ledger.terminalGate, ['id', 'script', 'status', 'packageScriptMustBeAbsent'], 'ledger.terminalGate');
  if (
    ledger.terminalGate.id !== 'kern-frontend' ||
    ledger.terminalGate.script !== 'test:kern-frontend' ||
    ledger.terminalGate.status !== 'planned' ||
    ledger.terminalGate.packageScriptMustBeAbsent !== true ||
    Object.hasOwn(packageJson.scripts, 'test:kern-frontend')
  ) fail('terminal frontend gate was exposed prematurely');
  if (!Array.isArray(ledger.authorities) || ledger.authorities.length !== AUTHORITY_IDS.length) {
    fail('authority roster drifted');
  }
  ledger.authorities.forEach((authority, index) => verifyAuthority(authority, index, authorityBytes));

  const catalog = parseJson(authorityBytes.get('builtin-node-types'), 'builtin node catalog');
  const constitution = parseJson(authorityBytes.get('structural-constitution'), 'structural constitution');
  const witness = parseJson(authorityBytes.get('structural-witness-ledger'), 'structural witness ledger');
  const eligibility = parseJson(authorityBytes.get('kir-eligibility'), 'KIR eligibility');
  uniqueStrings(catalog.nodeTypes, 'catalog.nodeTypes');
  exact(ledger.nodeClosure, ['count', 'dispositions'], 'ledger.nodeClosure');
  exact(ledger.propertyClosure, ['count', 'dispositions'], 'ledger.propertyClosure');
  exact(
    ledger.expressionClosure,
    ['kinds', 'binaryOperators', 'unaryOperators', 'unsupportedDisposition'],
    'ledger.expressionClosure',
  );
  exact(
    ledger.moduleClosure,
    ['rootKinds', 'symbolKinds', 'diagnosticsInArtifact', 'unsupportedDisposition'],
    'ledger.moduleClosure',
  );
  if (catalog.nodeTypes.length !== ledger.nodeClosure.count || constitution.nodes.length !== ledger.nodeClosure.count) {
    fail('node closure count drifted');
  }
  if (constitution.properties.length !== ledger.propertyClosure.count) fail('property closure count drifted');
  if (witness.nodes.length !== ledger.nodeClosure.count || witness.properties.length !== ledger.propertyClosure.count) {
    fail('witness ledger count drifted');
  }
  if (
    eligibility.sourceCoverage.length !== ledger.nodeClosure.count ||
    eligibility.sourceCoverage.some((row, index) => row.id !== catalog.nodeTypes[index])
  ) fail('KIR eligibility does not cover the ordered source catalog');
  const rowCounts = new Map([
    ['builtin-node-types', catalog.nodeTypes.length],
    ['structural-constitution', constitution.nodes.length + constitution.properties.length],
    ['structural-witness-ledger', witness.nodes.length + witness.properties.length],
    ['kir-eligibility', eligibility.sourceCoverage.length],
  ]);
  if (JSON.stringify(distribution(eligibility.sourceCoverage, 'disposition')) !== JSON.stringify(ledger.nodeClosure.dispositions)) {
    fail('node disposition distribution drifted');
  }
  if (JSON.stringify(distribution(constitution.properties, 'disposition')) !== JSON.stringify(ledger.propertyClosure.dispositions)) {
    fail('property disposition distribution drifted');
  }

  const expressionSource = authorityBytes.get('expression-contract').toString('utf8');
  let expressionRows = 0;
  for (const [field, declaration] of [['kinds', 'EXPRESSION_KINDS'], ['binaryOperators', 'BINARY_OPERATORS'], ['unaryOperators', 'UNARY_OPERATORS']]) {
    uniqueStrings(ledger.expressionClosure[field], `ledger.expressionClosure.${field}`);
    const sourceRows = sourceArray(expressionSource, declaration);
    expressionRows += sourceRows.length;
    if (JSON.stringify(sourceRows) !== JSON.stringify(ledger.expressionClosure[field])) {
      fail(`expression ${field} drifted`);
    }
  }
  rowCounts.set('expression-contract', expressionRows);
  if (ledger.expressionClosure.unsupportedDisposition !== 'FRONTEND_INVALID_EXPRESSION') {
    fail('expression unsupported disposition drifted');
  }
  const moduleSource = authorityBytes.get('module-contract').toString('utf8');
  const moduleRootKinds = sourceArray(moduleSource, 'MODULE_KIR_ROOT_KINDS');
  const moduleSymbolKinds = sourceArray(moduleSource, 'MODULE_KIR_SYMBOL_KINDS');
  if (
    JSON.stringify(moduleRootKinds) !== JSON.stringify(ledger.moduleClosure.rootKinds) ||
    JSON.stringify(moduleSymbolKinds) !== JSON.stringify(ledger.moduleClosure.symbolKinds) ||
    ledger.moduleClosure.diagnosticsInArtifact !== 0 ||
    ledger.moduleClosure.unsupportedDisposition !== 'FRONTEND_UNSUPPORTED_MODULE_ROOT'
  ) fail('module closure drifted');
  rowCounts.set('module-contract', moduleRootKinds.length + moduleSymbolKinds.length);
  uniqueStrings(ledger.diagnosticCodes, 'ledger.diagnosticCodes');
  const diagnosticTypeCodes = parserDiagnosticTypeCodes(
    authorityBytes.get('parser-diagnostic-types').toString('utf8'),
  );
  const diagnosticCodes = parserDiagnosticCodes(authorityBytes.get('parser-diagnostics').toString('utf8'));
  if (
    JSON.stringify(diagnosticTypeCodes) !== JSON.stringify(ledger.diagnosticCodes) ||
    JSON.stringify(diagnosticCodes) !== JSON.stringify(ledger.diagnosticCodes)
  ) fail('parser diagnostic catalog drifted');
  rowCounts.set('parser-diagnostic-types', diagnosticTypeCodes.length);
  rowCounts.set('parser-diagnostics', diagnosticCodes.length);
  for (const authorityId of AUTHORITY_IDS) {
    if (rowCounts.get(authorityId) !== authorityRows(ledger, authorityId)) {
      fail(`authority ${authorityId} row count drifted`);
    }
  }
  uniqueStrings(ledger.frontendFailureCodes, 'ledger.frontendFailureCodes');

  if (!Array.isArray(ledger.families) || ledger.families.length !== FAMILY_IDS.length) fail('frontend family roster drifted');
  const familyIds = new Set();
  for (const [index, family] of ledger.families.entries()) {
    exact(family, FAMILY_FIELDS, `ledger.families[${index}]`);
    for (const field of FAMILY_FIELDS) if (typeof family[field] !== 'string' || family[field].length === 0) fail(`family ${index}.${field} is empty`);
    if (familyIds.has(family.id)) fail(`duplicate frontend family ${family.id}`);
    familyIds.add(family.id);
    if (![...ledger.diagnosticCodes, ...ledger.frontendFailureCodes].includes(family.malformedDiagnostic)) {
      fail(`family ${family.id} diagnostic is outside the closure`);
    }
  }
  if (JSON.stringify([...familyIds]) !== JSON.stringify(FAMILY_IDS)) fail('frontend family order drifted');
  uniqueStrings(ledger.phases, 'ledger.phases');
  if (JSON.stringify(ledger.phases) !== JSON.stringify(PHASES)) {
    fail('frontend phase order drifted');
  }
  const goldenCounts = validateGoldens(
    goldens,
    ledger.diagnosticCodes,
    ledger.frontendFailureCodes,
    goldenBytes,
    ledger.goldens,
    semanticExpectations,
    semanticExpectationsBytes,
  );
  return {
    ...goldenCounts,
    diagnostics: ledger.diagnosticCodes.length + ledger.frontendFailureCodes.length,
    expressionKinds: ledger.expressionClosure.kinds.length,
    families: ledger.families.length,
    nodes: ledger.nodeClosure.count,
    properties: ledger.propertyClosure.count,
  };
}

export function loadFrontendClosureInputs() {
  const ledger = parseJson(readRegular(LEDGER_PATH), relative(ROOT, LEDGER_PATH));
  const goldenBytes = readRegular(GOLDENS_PATH);
  const goldens = parseJson(goldenBytes, relative(ROOT, GOLDENS_PATH));
  const packageJson = parseJson(readRegular(PACKAGE_PATH), relative(ROOT, PACKAGE_PATH));
  const semanticExpectationsBytes = readRegular(SEMANTIC_EXPECTATIONS_PATH);
  const semanticExpectations = parseJson(
    semanticExpectationsBytes,
    relative(ROOT, SEMANTIC_EXPECTATIONS_PATH),
  );
  const authorityBytes = new Map(
    AUTHORITY_IDS.map((authorityId) => [authorityId, readRegular(resolve(ROOT, AUTHORITY_PATHS[authorityId]))]),
  );
  return {
    authorityBytes,
    goldenBytes,
    goldens,
    ledger,
    packageJson,
    semanticExpectations,
    semanticExpectationsBytes,
  };
}

export function runFrontendClosureCheck() {
  return validateFrontendClosure(loadFrontendClosureInputs());
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  console.log(`KERN frontend surface closure: ${JSON.stringify(runFrontendClosureCheck())}`);
}
