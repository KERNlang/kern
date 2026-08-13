#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { encodeModuleKir } from '../packages/core/dist/kir-structural/module-canonical.js';
import { parseDocumentWithDiagnostics } from '../packages/core/dist/parser.js';
import { loadCanonicalizerPolicy } from './kern-canonicalizer/policy.mjs';
import { verifyKernFormatterComposition } from './kern-formatter/composition.mjs';
import { formatKernSource } from './kern-formatter/production.mjs';

function artifact(source, id, limits) {
  const parsed = parseDocumentWithDiagnostics(source);
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (parsed.partial || errors.length > 0) return null;
  try {
    return Buffer.from(encodeModuleKir([{ id, roots: parsed.root.children ?? [] }], limits));
  } catch (error) {
    if (
      error instanceof Error &&
      ['CanonicalValueDecodeError', 'ModuleKirError', 'StructuralKirError'].includes(error.name)
    ) {
      return null;
    }
    throw error;
  }
}

export function runKernFormatterCheck() {
  verifyKernFormatterComposition();
  const paths = execFileSync('git', ['ls-files', '*.kern'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const limits = loadCanonicalizerPolicy().kirLimits;
  let admitted = 0;
  let rejected = 0;
  let structural = 0;
  for (const path of paths) {
    if (process.env.KERN_FORMATTER_PROGRESS === '1') process.stderr.write(`[kern-formatter] ${path}\n`);
    const source = readFileSync(path, 'utf8');
    const first = formatKernSource(source);
    if (first.outcome === 'failure') {
      rejected += 1;
      assert.equal(first.source, null, path);
      continue;
    }
    admitted += 1;
    const second = formatKernSource(first.source);
    assert.equal(second.outcome, 'formatted', `${path}:second`);
    assert.equal(second.source, first.source, `${path}:idempotence`);
    const before = artifact(source, path, limits);
    if (before) {
      const after = artifact(first.source, path, limits);
      assert.ok(after, `${path}:formatted parse`);
      assert.ok(before.equals(after), `${path}:structural KIR`);
      structural += 1;
    }
  }
  assert.ok(admitted >= 191, `formatter admitted floor regressed: ${admitted}`);
  assert.ok(structural >= 27, `formatter structural-KIR floor regressed: ${structural}`);
  assert.ok(rejected <= 1, `formatter rejection ceiling regressed: ${rejected}`);
  return { admitted, paths: paths.length, rejected, structural };
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  const result = runKernFormatterCheck();
  process.stdout.write(
    `KERN formatter: ${result.admitted}/${result.paths} tracked sources admitted and idempotent, ${result.structural} structural KIR pairs equal, ${result.rejected} deterministic policy rejections.\n`,
  );
}
