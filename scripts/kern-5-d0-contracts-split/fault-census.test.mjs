import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FAULT_CENSUS_TOTALS,
  FAULT_CLASSIFIER_SITES,
  FAULT_MODEL_RULE,
  JAVASCRIPT_FAULT_CODES,
  JAVASCRIPT_FAULT_SITES,
  PYTHON_FAULT_CODES,
  PYTHON_FAULT_SITES,
  RUNTIME_FAULT_SITES,
} from './pins.mjs';
import { KIR_RUNTIME_DIR, occurrences, readRepositoryText, sourceFilesUnder } from './support.mjs';

function census(constructor) {
  const rows = {};
  for (const path of sourceFilesUnder('packages/core/src')) {
    const count = occurrences(readRepositoryText(path), constructor);
    if (count > 0) rows[path] = count;
  }
  return rows;
}

function codes(constructor, pattern) {
  const found = new Set();
  for (const path of sourceFilesUnder('packages/core/src')) {
    for (const match of readRepositoryText(path).matchAll(pattern)) found.add(match[1]);
  }
  assert.ok(found.size > 0, `D0_CENSUS_EMPTY: no ${constructor} code literal was found`);
  return [...found].sort();
}

function total(sites) {
  return Object.values(sites).reduce((sum, count) => sum + count, 0);
}

test('claim D0-F1 states the rule the census enforces', () => {
  assert.match(FAULT_MODEL_RULE, /VM-invariant collapse only/u);
  assert.match(FAULT_MODEL_RULE, /consciously extend this census/u);
});

test('the JavaScript kernel constructs __Fault at exactly the pinned sites', () => {
  assert.deepEqual(
    census('new __Fault('),
    { ...JAVASCRIPT_FAULT_SITES },
    'D0_FAULT_CENSUS: the new __Fault( construction sites moved',
  );
  assert.equal(total(JAVASCRIPT_FAULT_SITES), FAULT_CENSUS_TOTALS.javascript);
});

test('the JavaScript kernel constructs __Fault over exactly ten codes', () => {
  assert.deepEqual(
    codes('new __Fault(', /new __Fault\('([a-z-]+)'/gu),
    [...JAVASCRIPT_FAULT_CODES],
    'D0_FAULT_CODES: the __Fault code set moved',
  );
  assert.equal(JAVASCRIPT_FAULT_CODES.length, 10);
});

test('the Python kernel raises _Fault at exactly the pinned sites', () => {
  assert.deepEqual(
    census('raise _Fault('),
    { ...PYTHON_FAULT_SITES },
    'D0_FAULT_CENSUS: the raise _Fault( construction sites moved',
  );
  assert.equal(total(PYTHON_FAULT_SITES), FAULT_CENSUS_TOTALS.python);
});

// Nine, not ten: the Python kernel has no handler-link-error site. Closing that gap widens the
// catchable surface on one leg only, so it has to move this row.
test('the Python kernel raises _Fault over exactly nine codes', () => {
  assert.deepEqual(
    codes('raise _Fault(', /raise _Fault\("([a-z-]+)"/gu),
    [...PYTHON_FAULT_CODES],
    'D0_FAULT_CODES: the _Fault code set moved',
  );
  assert.deepEqual(
    JAVASCRIPT_FAULT_CODES.filter((code) => !PYTHON_FAULT_CODES.includes(code)),
    ['handler-link-error'],
    'D0_FAULT_CODES: the leg asymmetry is no longer exactly handler-link-error',
  );
});

test('the TypeScript runtime constructs KernKirFault at exactly the pinned nine files', () => {
  assert.deepEqual(
    census('new KernKirFault('),
    { ...RUNTIME_FAULT_SITES },
    'D0_FAULT_CENSUS: the new KernKirFault( construction sites moved',
  );
  assert.equal(total(RUNTIME_FAULT_SITES), FAULT_CENSUS_TOTALS.runtime);
  assert.equal(Object.keys(RUNTIME_FAULT_SITES).length, 9);
});

test('the split redistributes KernKirFault sites without changing their total', () => {
  const rows = census('new KernKirFault(');
  const linked = Object.entries(rows).filter(([path]) => path.includes('/linked-kir-program/'));
  assert.equal(
    linked.reduce((sum, [, count]) => sum + count, 0),
    5,
    'D0_FAULT_CENSUS: the linked-kir-program directory must keep exactly five KernKirFault sites',
  );
  assert.equal(total(rows), FAULT_CENSUS_TOTALS.runtime);
});

test('no class extends a kernel fault type', () => {
  for (const path of sourceFilesUnder('packages/core/src')) {
    const source = readRepositoryText(path);
    for (const forbidden of ['extends __Fault', 'extends _Fault', '(_Fault)', '(__Fault)']) {
      assert.equal(
        source.includes(forbidden),
        false,
        `D0_FAULT_SUBCLASSED: ${path} derives from a kernel fault type via ${forbidden}`,
      );
    }
  }
});

test('every KernKirFault classifier sits at exactly the pinned site census', () => {
  const rows = {};
  for (const path of sourceFilesUnder('packages/core/src')) {
    const count = occurrences(readRepositoryText(path), 'instanceof KernKirFault');
    if (count > 0) rows[path] = count;
  }
  assert.deepEqual(
    rows,
    { ...FAULT_CLASSIFIER_SITES },
    'D0_FAULT_BOUNDARY: the instanceof KernKirFault site census moved',
  );
});

// C-12 in the strict form that is true at base: inside kir-runtime every guarded catch re-throws
// the fault on the same line. Nothing catches one and resumes handler execution.
test('every guarded catch inside kir-runtime re-throws the fault instead of resuming', () => {
  let guards = 0;
  for (const path of sourceFilesUnder(KIR_RUNTIME_DIR)) {
    for (const line of readRepositoryText(path).split('\n')) {
      if (!line.includes('if (error instanceof KernKirFault')) continue;
      guards += 1;
      assert.ok(
        line.includes('throw error'),
        `D0_FAULT_SWALLOWED: ${path} guards a KernKirFault without re-throwing it`,
      );
    }
  }
  assert.equal(guards, 4, 'D0_FAULT_BOUNDARY: the guarded-catch count inside kir-runtime moved');
});

test('execute.ts holds the single fault-to-envelope conversion in the runtime', () => {
  assert.equal(
    occurrences(readRepositoryText(`${KIR_RUNTIME_DIR}/execute.ts`), 'return failureEnvelope('),
    1,
    'D0_FAULT_BOUNDARY: execute.ts must hold exactly one fault-to-envelope conversion',
  );
  for (const path of sourceFilesUnder(KIR_RUNTIME_DIR)) {
    if (path.endsWith('/execute.ts')) continue;
    assert.equal(
      occurrences(readRepositoryText(path), 'return failureEnvelope('),
      0,
      `D0_FAULT_BOUNDARY: ${path} converts a fault to an envelope outside the request boundary`,
    );
  }
});
