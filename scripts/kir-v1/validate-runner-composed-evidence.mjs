import { createHash } from 'node:crypto';
import ts from 'typescript';

const WITNESS_PATH = 'packages/core/tests/kern-kir-runner-composed-fixtures.ts';
const WITNESS_CONSTANT = 'COMPOSED_RUNNER_WITNESSES';
const WITNESS_FORMAT = 'kern.kir.runner-composed-witnesses.p1.1';
const WITNESS_KEYS = Object.freeze([
  'id',
  'witnessId',
  'semanticEnvelopeId',
  'fixtureId',
  'oracleId',
  'excludedProperties',
]);

function fail(message) {
  throw new Error(`KIR v1 eligibility: ${message}`);
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly ${wanted.join(', ')}`);
  }
}

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(`${label} must be non-empty text`);
}

function sameOrdered(actual, expected, label) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`${label} drifted`);
  }
}

function sameSet(actual, expected, label) {
  if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length) {
    fail(`${label} must not contain duplicates`);
  }
  sameOrdered([...actual].sort(), [...expected].sort(), label);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function unwrap(node) {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return unwrap(node.expression);
  }
  return node;
}

function hasConstAssertion(node) {
  if (ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) return hasConstAssertion(node.expression);
  return (
    ts.isAsExpression(node) &&
    ts.isTypeReferenceNode(node.type) &&
    ts.isIdentifier(node.type.typeName) &&
    node.type.typeName.text === 'const'
  );
}

function topLevelDeclaration(sourceFile, constantName) {
  const matches = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === constantName) matches.push(declaration);
    }
  }
  if (matches.length !== 1) fail(`${sourceFile.fileName} must contain exactly one top-level ${constantName}`);
  return matches[0];
}

function propertyName(property, label) {
  if (!ts.isPropertyAssignment(property) || property.name === undefined) fail(`${label} must use static property assignments`);
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
  fail(`${label} must use static property names`);
}

function stringLiteral(node, label) {
  const value = unwrap(node);
  if (!ts.isStringLiteral(value)) fail(`${label} must remain a string literal`);
  return value.text;
}

function stringArray(node, label) {
  const value = unwrap(node);
  if (!ts.isArrayLiteralExpression(value)) fail(`${label} must remain a static string array`);
  const result = value.elements.map((element, index) => stringLiteral(element, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates`);
  return result;
}

export function extractStaticRunnerWitnesses(source, sourcePath, constantName = WITNESS_CONSTANT) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) fail(`cannot parse ${sourcePath}`);
  const declaration = topLevelDeclaration(sourceFile, constantName);
  if (!declaration.initializer || !hasConstAssertion(declaration.initializer)) {
    fail(`${constantName} in ${sourcePath} must retain its const assertion`);
  }
  const initializer = unwrap(declaration.initializer);
  if (!ts.isArrayLiteralExpression(initializer)) fail(`${constantName} in ${sourcePath} must remain a static array literal`);

  const witnesses = initializer.elements.map((element, index) => {
    const value = unwrap(element);
    if (!ts.isObjectLiteralExpression(value)) fail(`${constantName}[${index}] must remain a static object literal`);
    const fields = {};
    for (const property of value.properties) {
      const name = propertyName(property, `${constantName}[${index}]`);
      if (Object.hasOwn(fields, name)) fail(`${constantName}[${index}] contains duplicate ${name}`);
      fields[name] = property.initializer;
    }
    exactKeys(fields, WITNESS_KEYS, `${constantName}[${index}]`);
    return {
      id: stringLiteral(fields.id, `${constantName}[${index}].id`),
      witnessId: stringLiteral(fields.witnessId, `${constantName}[${index}].witnessId`),
      semanticEnvelopeId: stringLiteral(fields.semanticEnvelopeId, `${constantName}[${index}].semanticEnvelopeId`),
      fixtureId: stringLiteral(fields.fixtureId, `${constantName}[${index}].fixtureId`),
      oracleId: stringLiteral(fields.oracleId, `${constantName}[${index}].oracleId`),
      excludedProperties: stringArray(fields.excludedProperties, `${constantName}[${index}].excludedProperties`),
    };
  });
  const ids = witnesses.map((witness) => witness.id);
  if (new Set(ids).size !== ids.length) fail(`${constantName} contains duplicate runner ids`);
  return witnesses;
}

export function runnerWitnessDigest(witnesses) {
  return createHash('sha256').update(JSON.stringify(witnesses)).digest('hex');
}

function exclusionId(property) {
  return `${property.propertyName}:${property.disposition}`;
}

function expectedCoverage(runnerIds, witnesses, constitution) {
  if (!Array.isArray(constitution.nodes) || !Array.isArray(constitution.properties)) {
    fail('structural constitution must expose nodes and properties');
  }
  const nodeIds = new Set(constitution.nodes.map((node) => node.id));
  const propertiesByNode = new Map();
  for (const property of constitution.properties) {
    const properties = propertiesByNode.get(property.nodeKind) ?? [];
    properties.push(property);
    propertiesByNode.set(property.nodeKind, properties);
  }
  const witnessById = new Map(witnesses.map((witness) => [witness.id, witness]));

  const rows = runnerIds.map((id) => {
    if (!nodeIds.has(id)) {
      if (witnessById.has(id)) fail(`blocked runner ${id} must not have a composed witness`);
      return { id, disposition: 'structural-blocker', blockerId: 'source-node-absent', nextMilestone: 'P1-constitution-expansion' };
    }
    const properties = propertiesByNode.get(id) ?? [];
    const requiredExclusions = properties.filter(
      (property) => property.required === true && property.disposition.startsWith('excluded-host-'),
    );
    if (requiredExclusions.length > 0) {
      if (witnessById.has(id)) fail(`blocked runner ${id} must not have a composed witness`);
      const blockerId = requiredExclusions.map((property) => `required-${exclusionId(property)}`).join('+');
      return { id, disposition: 'structural-blocker', blockerId, nextMilestone: 'P1-constitution-expansion' };
    }
    const witness = witnessById.get(id);
    if (!witness) fail(`runner ${id} requires a composed witness`);
    const excludedProperties = properties
      .filter((property) => property.required === false && property.disposition.startsWith('excluded-host-'))
      .map(exclusionId);
    sameSet(witness.excludedProperties, excludedProperties, `runner ${id} excluded properties`);
    return { ...witness, excludedProperties: [...excludedProperties].sort(), disposition: 'internal-composed-witness' };
  });
  const expectedWitnessIds = rows
    .filter((row) => row.disposition === 'internal-composed-witness')
    .map((row) => row.id);
  sameOrdered(witnesses.map((witness) => witness.id), expectedWitnessIds, 'runner witness ids');
  return rows;
}

export function validateRunnerComposedEvidence(catalog, rows, runnerIds, readText) {
  exactKeys(catalog, ['path', 'constant', 'format', 'canonicalSha256'], 'runnerWitnessCatalog');
  if (catalog.path !== WITNESS_PATH || catalog.constant !== WITNESS_CONSTANT) fail('runner witness source binding changed');
  if (catalog.format !== WITNESS_FORMAT) fail('runner witness format changed');
  if (!/^[0-9a-f]{64}$/u.test(catalog.canonicalSha256)) fail('runner witness SHA-256 is invalid');
  const witnesses = extractStaticRunnerWitnesses(readText(catalog.path), catalog.path, catalog.constant);
  if (runnerWitnessDigest(witnesses) !== catalog.canonicalSha256) fail('runner witness catalog digest drifted');
  const expected = expectedCoverage(runnerIds, witnesses, JSON.parse(readText('scripts/kir-structural/constitution.json')));
  if (!Array.isArray(rows) || rows.length !== expected.length) fail('runnerCoverage must classify every runner contract');
  rows.forEach((row, index) => {
    const expectedRow = expected[index];
    exactKeys(row, Object.keys(expectedRow), `runnerCoverage[${index}]`);
    if (canonicalJson(row) !== canonicalJson(expectedRow)) fail(`runner coverage ${row.id ?? index} drifted`);
  });
  const witnessedRunnerContractCount = expected.filter(
    (row) => row.disposition === 'internal-composed-witness',
  ).length;
  const structurallyBlockedRunnerContractCount = expected.length - witnessedRunnerContractCount;
  return {
    runnerContractCount: expected.length,
    witnessedRunnerContractCount,
    structurallyBlockedRunnerContractCount,
    unclassifiedRunnerContractCount: 0,
  };
}
