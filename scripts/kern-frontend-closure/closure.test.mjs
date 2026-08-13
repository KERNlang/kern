import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { decodeCanonicalValue, encodeCanonicalValue } from '../../packages/core/dist/canonical-value/canonical.js';

import {
  loadFrontendClosureInputs,
  runFrontendClosureCheck,
  validateFrontendClosure,
} from './validate.mjs';

function cloneInputs() {
  const input = loadFrontendClosureInputs();
  return {
    authorityBytes: new Map([...input.authorityBytes].map(([key, value]) => [key, Buffer.from(value)])),
    goldenBytes: Buffer.from(input.goldenBytes),
    goldens: structuredClone(input.goldens),
    ledger: structuredClone(input.ledger),
    packageJson: structuredClone(input.packageJson),
    semanticExpectations: structuredClone(input.semanticExpectations),
    semanticExpectationsBytes: Buffer.from(input.semanticExpectationsBytes),
  };
}

function syncGoldens(input) {
  input.goldenBytes = Buffer.from(`${JSON.stringify(input.goldens, null, 2)}\n`);
  input.ledger.goldens.sha256 = createHash('sha256').update(input.goldenBytes).digest('hex');
}

test('F0 closes the complete current source-to-KIR contract without promotion', () => {
  assert.deepEqual(runFrontendClosureCheck(), {
    artifactBytes: 6962,
    diagnostics: 32,
    expressionKinds: 16,
    failures: 6,
    families: 9,
    modules: 2,
    nodes: 302,
    properties: 1149,
  });
});

test('authority digest and row drift fail closed', () => {
  const digest = cloneInputs();
  digest.ledger.authorities[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateFrontendClosure(digest), /authority builtin-node-types digest drifted/u);

  const rows = cloneInputs();
  rows.ledger.nodeClosure.count -= 1;
  assert.throws(() => validateFrontendClosure(rows), /node closure count drifted/u);

  const disposition = cloneInputs();
  disposition.ledger.nodeClosure.dispositions.invented = 0;
  assert.throws(() => validateFrontendClosure(disposition), /node disposition distribution drifted/u);

  const declaredRows = cloneInputs();
  declaredRows.ledger.authorities[4].rows -= 1;
  assert.throws(() => validateFrontendClosure(declaredRows), /authority expression-contract row count drifted/u);

  const path = cloneInputs();
  path.ledger.authorities[0].path = 'scripts/kern-frontend-closure/static-goldens.json';
  assert.throws(() => validateFrontendClosure(path), /authority builtin-node-types path drifted/u);

  const baseline = cloneInputs();
  baseline.ledger.baseline = '0'.repeat(40);
  assert.throws(() => validateFrontendClosure(baseline), /baseline drifted/u);
});

test('missing family fields, duplicate diagnostics, and phase reorder fail closed', () => {
  const field = cloneInputs();
  delete field.ledger.families[0].kir;
  assert.throws(() => validateFrontendClosure(field), /ledger\.families\[0\].*fields must be/u);

  const diagnostic = cloneInputs();
  diagnostic.ledger.diagnosticCodes.push(diagnostic.ledger.diagnosticCodes[0]);
  assert.throws(() => validateFrontendClosure(diagnostic), /diagnosticCodes must be unique/u);

  const phase = cloneInputs();
  [phase.ledger.phases[2], phase.ledger.phases[3]] = [phase.ledger.phases[3], phase.ledger.phases[2]];
  assert.throws(() => validateFrontendClosure(phase), /frontend phase order drifted/u);

  const family = cloneInputs();
  [family.ledger.families[1], family.ledger.families[2]] = [family.ledger.families[2], family.ledger.families[1]];
  assert.throws(() => validateFrontendClosure(family), /frontend family order drifted/u);

  const span = cloneInputs();
  span.goldens.failures[0].diagnostics[0].endCol += 1;
  syncGoldens(span);
  assert.throws(() => validateFrontendClosure(span), /span is out of range/u);
});

test('static canonical bytes cannot be changed or replaced with a placeholder', () => {
  const changed = cloneInputs();
  const canonical = decodeCanonicalValue(Buffer.from(changed.goldens.valid.expectedCanonicalBase64, 'base64'), {
    maxBytes: 262_144, maxCollectionLength: 1_024, maxDecimalChars: 520, maxDepth: 64,
    maxFractionDigits: 256, maxIntegerDigits: 256, maxMapEntries: 64, maxNodes: 4_096,
    maxRecordFields: 512, maxStringBytes: 8_192,
  });
  const stack = [canonical];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value.tag === 'text' && value.value === '*') {
      value.value = '/';
      break;
    }
    if (value.tag === 'list') stack.push(...value.value);
    if (value.tag === 'record') stack.push(...value.value.map((entry) => entry.value));
  }
  changed.goldens.valid.expectedCanonicalBase64 = Buffer.from(encodeCanonicalValue(canonical, {
    maxBytes: 262_144, maxCollectionLength: 1_024, maxDecimalChars: 520, maxDepth: 64,
    maxFractionDigits: 256, maxIntegerDigits: 256, maxMapEntries: 64, maxNodes: 4_096,
    maxRecordFields: 512, maxStringBytes: 8_192,
  })).toString('base64');
  changed.ledger.goldens.canonicalSha256 = createHash('sha256')
    .update(Buffer.from(changed.goldens.valid.expectedCanonicalBase64, 'base64'))
    .digest('hex');
  syncGoldens(changed);
  assert.throws(() => validateFrontendClosure(changed), /decoded KIR drifted/u);

  const placeholder = cloneInputs();
  placeholder.goldens.valid.modules[0].source = 'PENDING_F0\n';
  syncGoldens(placeholder);
  assert.throws(() => validateFrontendClosure(placeholder), /placeholder|source is missing/u);

  const unrelated = cloneInputs();
  unrelated.goldens.valid.modules[1].source += 'fn name=admin export=true\n';
  syncGoldens(unrelated);
  assert.throws(() => validateFrontendClosure(unrelated), /valid module main\.kern source drifted/u);

  const fabricatedFailure = cloneInputs();
  fabricatedFailure.goldens.failures[0].source = fabricatedFailure.goldens.failures[0].source
    .replace(/[^\n]/gu, 'x');
  syncGoldens(fabricatedFailure);
  assert.throws(() => validateFrontendClosure(fabricatedFailure), /failure excluded-raw-block source drifted/u);

  const unknownDiagnostic = cloneInputs();
  unknownDiagnostic.goldens.failures[0].diagnostics[0].code = 'NOT_A_DIAGNOSTIC';
  syncGoldens(unknownDiagnostic);
  assert.throws(() => validateFrontendClosure(unknownDiagnostic), /outside the closure/u);

  const digest = cloneInputs();
  digest.goldenBytes[0] ^= 1;
  assert.throws(() => validateFrontendClosure(digest), /golden digest drifted/u);
});

test('terminal frontend script exposure is rejected until F7', () => {
  const input = cloneInputs();
  input.packageJson.scripts['test:kern-frontend'] = 'node forbidden-placeholder.mjs';
  assert.throws(() => validateFrontendClosure(input), /terminal frontend gate was exposed prematurely/u);
});
