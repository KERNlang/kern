import { createHash } from 'node:crypto';

const EXPECTATIONS_SHA256 = '19c0029028f29b1070e23dbb60558d6bc0ae2387f91391a9f82635a5efd7cd59';

function fail(message) {
  throw new Error(`KERN frontend semantic expectations: ${message}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exact(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${path} fields drifted`);
}

function uniqueLines(lines, path) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.some((line) => typeof line !== 'string' || line.length === 0)) {
    fail(`${path} must contain non-empty lines`);
  }
  if (new Set(lines).size !== lines.length) fail(`${path} must be unique`);
}

export function validateSemanticExpectations({ artifact, expectations, expectationsBytes, goldens }) {
  if (!Buffer.isBuffer(expectationsBytes) || digest(expectationsBytes) !== EXPECTATIONS_SHA256) {
    fail('manifest digest drifted');
  }
  let parsed;
  try {
    parsed = JSON.parse(expectationsBytes.toString('utf8'));
  } catch {
    fail('manifest must be valid JSON');
  }
  if (JSON.stringify(parsed) !== JSON.stringify(expectations)) fail('manifest payload drifted');
  exact(expectations, ['schemaVersion', 'format', 'validModules', 'failures'], 'expectations');
  if (expectations.schemaVersion !== 1 || expectations.format !== 'kern.frontend.semantic-expectations.1') {
    fail('manifest format drifted');
  }
  if (
    !Array.isArray(expectations.validModules) ||
    expectations.validModules.length !== goldens.valid.modules.length ||
    artifact.modules.length !== goldens.valid.modules.length
  ) fail('valid module roster drifted');

  for (const [index, expected] of expectations.validModules.entries()) {
    exact(
      expected,
      ['id', 'sourceSha256', 'decodedModuleSha256', 'requiredLines'],
      `expectations.validModules[${index}]`,
    );
    const golden = goldens.valid.modules[index];
    const decoded = artifact.modules[index];
    if (expected.id !== golden.id || expected.id !== decoded.id) fail(`valid module ${index} identity drifted`);
    if (digest(golden.source) !== expected.sourceSha256) fail(`valid module ${expected.id} source drifted`);
    if (digest(JSON.stringify(decoded)) !== expected.decodedModuleSha256) {
      fail(`valid module ${expected.id} decoded KIR drifted`);
    }
    uniqueLines(expected.requiredLines, `expectations.validModules[${index}].requiredLines`);
    const sourceLines = new Set(golden.source.split('\n'));
    for (const line of expected.requiredLines) {
      if (!sourceLines.has(line)) fail(`valid module ${expected.id} is missing ${JSON.stringify(line)}`);
    }
  }

  if (!Array.isArray(expectations.failures) || expectations.failures.length !== goldens.failures.length) {
    fail('failure roster drifted');
  }
  for (const [index, expected] of expectations.failures.entries()) {
    exact(
      expected,
      ['id', 'moduleId', 'sourceSha256', 'diagnosticsSha256', 'triggerLines'],
      `expectations.failures[${index}]`,
    );
    const golden = goldens.failures[index];
    if (expected.id !== golden.id || expected.moduleId !== golden.moduleId) {
      fail(`failure ${index} identity drifted`);
    }
    if (digest(golden.source) !== expected.sourceSha256) fail(`failure ${expected.id} source drifted`);
    if (digest(JSON.stringify(golden.diagnostics)) !== expected.diagnosticsSha256) {
      fail(`failure ${expected.id} diagnostics drifted`);
    }
    uniqueLines(expected.triggerLines, `expectations.failures[${index}].triggerLines`);
    const sourceLines = new Set(golden.source.split('\n'));
    for (const line of expected.triggerLines) {
      if (!sourceLines.has(line)) fail(`failure ${expected.id} is missing trigger ${JSON.stringify(line)}`);
    }
  }
}
