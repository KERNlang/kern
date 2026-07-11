import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeCanonical, encodeCanonical } from './canonical.mjs';
import { hostileModules } from './fixtures.mjs';
import { projectModules } from './project.mjs';

const artifact = projectModules(hostileModules);
const bytes = encodeCanonical(artifact);

function findTagged(value, tag) {
  if (value !== null && typeof value === 'object') {
    if (value.tag === tag) return value;
    for (const child of Object.values(value)) {
      const found = findTagged(child, tag);
      if (found) return found;
    }
  }
  return undefined;
}

function findExpressionKind(value, kind) {
  if (value !== null && typeof value === 'object') {
    if (value.tag === 'expression' && value.value.kind === kind) return value.value;
    for (const child of Object.values(value)) {
      const found = findExpressionKind(child, kind);
      if (found) return found;
    }
  }
  return undefined;
}

test('strict reader round-trips one fully validated canonical artifact', () => {
  assert.deepEqual(decodeCanonical(bytes), artifact);
  assert.equal(bytes.endsWith('\n'), true);
  assert.equal(bytes.endsWith('\n\n'), false);
});

test('strict reader rejects unknown format, fields, tags, and noncanonical bytes before returning', () => {
  const mutations = [
    { mutate(value) { value.format = 'kern.semantic-kir.v1'; }, error: /unsupported format/u },
    { mutate(value) { value.surprise = true; }, error: /expected fields/u },
    { mutate(value) { value.modules[0].nodes[0].properties[0].value.tag = 'host-object'; }, error: /unknown value tag/u },
    { mutate(value) { value.modules[0].nodes[0].surprise = true; }, error: /expected fields/u },
  ];
  for (const mutation of mutations) {
    const copy = structuredClone(artifact);
    mutation.mutate(copy);
    assert.throws(() => decodeCanonical(`${JSON.stringify(copy)}\n`), mutation.error);
  }
  assert.throws(() => decodeCanonical(JSON.stringify(artifact)), /terminal newline/u);
  assert.throws(() => decodeCanonical(` ${bytes}`), /not canonical/u);
});

test('named serializer mutations are killed', async (suite) => {
  await suite.test('insertion-order mutation', () => {
    const copy = structuredClone(artifact);
    const reordered = { modules: copy.modules, diagnostics: copy.diagnostics, format: copy.format };
    assert.notEqual(`${JSON.stringify(reordered)}\n`, bytes);
    assert.equal(encodeCanonical(reordered), bytes);
  });
  await suite.test('native-number mutation', () => {
    const copy = structuredClone(artifact);
    const int = copy.modules[1].nodes[0].children[0].children[0].properties.find((entry) => entry.key === 'value');
    int.value = { tag: 'int', value: Number.MAX_SAFE_INTEGER + 1 };
    assert.throws(() => encodeCanonical(copy), /expected string/u);
  });
  await suite.test('Unicode-normalization mutation', () => {
    assert.notEqual(bytes.normalize('NFC'), bytes);
  });
  await suite.test('dropped-location mutation', () => {
    const copy = structuredClone(artifact);
    delete copy.modules[0].nodes[0].location;
    assert.throws(() => encodeCanonical(copy), /expected fields/u);
  });
  await suite.test('ignored-unknown-field mutation', () => {
    const copy = structuredClone(artifact);
    copy.modules[0].nodes[0].unknown = null;
    assert.throws(() => encodeCanonical(copy), /expected fields/u);
  });
  await suite.test('sorted-semantic-child mutation', () => {
    const copy = structuredClone(artifact);
    const body = copy.modules.find((module) => module.id === 'main.kern').nodes[0].children[0].children;
    body.reverse();
    assert.notEqual(encodeCanonical(copy), bytes);
  });
});

test('hostile duplicate keys and malformed spans fail closed', () => {
  const duplicate = structuredClone(artifact);
  const properties = duplicate.modules[0].nodes[0].properties;
  properties.push(structuredClone(properties[0]));
  assert.throws(() => encodeCanonical(duplicate), /duplicate key|strictly code-point sorted/u);

  const malformed = structuredClone(artifact);
  malformed.modules[0].nodes[0].location.start.line = 0;
  assert.throws(() => encodeCanonical(malformed), /positive safe integer/u);

  const reversed = structuredClone(artifact);
  reversed.modules[0].nodes[0].location.end = { line: 1, column: 1 };
  reversed.modules[0].nodes[0].location.start = { line: 2, column: 1 };
  assert.throws(() => encodeCanonical(reversed), /precedes start/u);

  const missingNodeProperty = structuredClone(artifact);
  missingNodeProperty.modules[0].nodes[0].properties = missingNodeProperty.modules[0].nodes[0].properties
    .filter((entry) => entry.key !== 'name');
  assert.throws(() => encodeCanonical(missingNodeProperty), /missing semantic field name/u);

  const invalidIdentifier = structuredClone(artifact);
  invalidIdentifier.modules[0].nodes[0].properties.find((entry) => entry.key === 'name').value.value = 'not valid';
  assert.throws(() => encodeCanonical(invalidIdentifier), /expected portable identifier/u);

  const missingExpressionField = structuredClone(artifact);
  const binary = findExpressionKind(missingExpressionField, 'binary');
  binary.fields = binary.fields.filter((entry) => entry.key !== 'right');
  assert.throws(() => encodeCanonical(missingExpressionField), /missing semantic field right/u);

  const invalidChild = structuredClone(artifact);
  invalidChild.modules[0].nodes[0].children.push(structuredClone(artifact.modules[1].nodes[0].children[0].children.at(-1)));
  assert.throws(() => encodeCanonical(invalidChild), /print is not allowed under fn/u);
});

test('strict reader revalidates module graph identity and links', () => {
  const missingModule = structuredClone(artifact);
  missingModule.modules[1].imports[0].source = 'missing.kern';
  assert.throws(() => encodeCanonical(missingModule), /missing module/u);

  const missingExport = structuredClone(artifact);
  missingExport.modules[1].imports[0].bindings[0].imported = 'absent';
  assert.throws(() => encodeCanonical(missingExport), /missing export/u);

  const wrongKind = structuredClone(artifact);
  wrongKind.modules[1].imports[0].bindings[0].kind = 'class';
  assert.throws(() => encodeCanonical(wrongKind), /probe binding kind must be fn/u);

  const wrongReexportKind = structuredClone(artifact);
  wrongReexportKind.modules[1].exports.find((item) => item.name === 'twice').kind = 'class';
  assert.throws(() => encodeCanonical(wrongReexportKind), /probe export kind must be fn/u);

  const duplicateExport = structuredClone(artifact);
  duplicateExport.modules[1].exports.push(structuredClone(duplicateExport.modules[1].exports[0]));
  assert.throws(() => encodeCanonical(duplicateExport), /duplicate export/u);

  const fakeLocalExport = structuredClone(artifact);
  fakeLocalExport.modules[0].exports.unshift({ name: 'absent', kind: 'fn', source: null });
  assert.throws(() => encodeCanonical(fakeLocalExport), /local export has no declaration/u);

  const declarationCollision = structuredClone(artifact);
  declarationCollision.modules[1].imports[0].bindings[0].local = 'main';
  assert.throws(() => encodeCanonical(declarationCollision), /duplicate local binding main/u);

  const cycle = structuredClone(artifact);
  cycle.modules[0].imports.push({
    source: 'main.kern',
    bindings: [{ imported: 'main', local: 'mainFromRoot', kind: 'fn', reexport: false }],
  });
  assert.throws(() => encodeCanonical(cycle), /module cycle/u);

  const detachedReexport = structuredClone(artifact);
  detachedReexport.modules[1].imports = [];
  assert.throws(() => encodeCanonical(detachedReexport), /re-export source is not imported/u);

  const driveQualified = structuredClone(artifact);
  driveQualified.modules[0].id = 'C:/lib/math.kern';
  assert.throws(() => encodeCanonical(driveQualified), /relative POSIX id/u);

  for (const id of ['./lib/math.kern', 'lib//math.kern', 'lib/math.kern/', 'lib/\u0000math.kern']) {
    const noncanonicalId = structuredClone(artifact);
    noncanonicalId.modules[0].id = id;
    assert.throws(() => encodeCanonical(noncanonicalId), /relative POSIX id/u);
  }
});

test('strict reader enforces canonical export and diagnostic order', () => {
  const exportsOutOfOrder = structuredClone(artifact);
  exportsOutOfOrder.modules[1].exports.reverse();
  assert.throws(() => encodeCanonical(exportsOutOfOrder), /exports must be strictly/u);

  const diagnosticsOutOfOrder = structuredClone(artifact);
  const location = { start: { line: 1, column: 1 }, end: null };
  diagnosticsOutOfOrder.diagnostics = [
    { module: 'main.kern', code: 'Z_CODE', severity: 'warning', category: 'parser', message: 'z', location },
    { module: 'main.kern', code: 'A_CODE', severity: 'warning', category: 'parser', message: 'a', location },
  ];
  assert.throws(() => encodeCanonical(diagnosticsOutOfOrder), /diagnostics must be strictly sorted/u);

  const danglingDiagnostic = structuredClone(artifact);
  danglingDiagnostic.diagnostics = [
    { module: 'missing.kern', code: 'E_MISSING', severity: 'error', category: 'parser', message: 'missing', location },
  ];
  assert.throws(() => encodeCanonical(danglingDiagnostic), /missing module missing.kern/u);

  const invalidRegex = structuredClone(artifact);
  findTagged(invalidRegex, 'regex').value.pattern = '[';
  assert.throws(() => encodeCanonical(invalidRegex), /invalid regex pattern/u);

  assert.throws(() => encodeCanonical({ format: artifact.format, modules: [], diagnostics: [] }), /at least one module/u);
});
