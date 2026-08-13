import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { loadCanonicalizerPolicy } from '../kern-canonicalizer/policy.mjs';
import { VALID_FORMATTER_FIXTURES } from './fixtures.mjs';
import { formatKernSource } from './production.mjs';

const limits = loadCanonicalizerPolicy().kirLimits;

function kir(source, id) {
  const parsed = parseDocumentWithDiagnostics(source);
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  assert.equal(parsed.partial, undefined, `${id}:partial`);
  assert.deepEqual(errors, [], `${id}:diagnostics`);
  return Buffer.from(encodeModuleKir([{ id: `${id}.kern`, roots: parsed.root.children ?? [] }], limits));
}

test('independent bootstrap parser produces identical structural KIR after formatting', () => {
  for (const fixture of VALID_FORMATTER_FIXTURES.filter((item) => item.structural)) {
    const formatted = formatKernSource(fixture.source);
    assert.equal(formatted.outcome, 'formatted', fixture.id);
    assert.ok(kir(fixture.source, fixture.id).equals(kir(formatted.source, fixture.id)), fixture.id);
  }
});
