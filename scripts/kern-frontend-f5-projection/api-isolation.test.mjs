import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT_PACKAGE = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const CORE_PACKAGE = JSON.parse(readFileSync(new URL('../../packages/core/package.json', import.meta.url), 'utf8'));
const POLICY = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));

test('A12 F5 stays private while the direct package gate force-builds core and runs the real wall', () => {
  assert.equal(ROOT_PACKAGE.scripts['test:kern-frontend'], undefined, 'terminal frontend remains unpromoted');
  assert.equal(ROOT_PACKAGE.scripts['test:kern-frontend-f5-projection'],
    'pnpm --filter @kernlang/core exec tsc -b --force && node --test scripts/kern-frontend-f5-projection/*.test.mjs');
  const publicSurface = JSON.stringify({ exports: CORE_PACKAGE.exports, files: CORE_PACKAGE.files });
  assert.doesNotMatch(publicSurface, /f5-projection|frontend-f5/u);
});

test('A12 predecessor and KIR ABI identities remain frozen', () => {
  assert.deepEqual({
    document: POLICY.documentFormat,
    moduleSet: POLICY.moduleSetFormat,
    projection: POLICY.resultFormat,
  }, {
    document: 'kern.frontend.f4-document.2',
    moduleSet: 'kern.frontend.f4-module-set.4',
    projection: 'kern.frontend.f5-projection.1',
  });
  const moduleTypes = readFileSync(new URL('../../packages/core/src/kir-structural/module-types.ts', import.meta.url),
    'utf8');
  assert.match(moduleTypes, /MODULE_KIR_ARTIFACT_FORMAT = 'kern\.kir\.modules\.r1\.5e\.1-alpha'/u);
  assert.match(moduleTypes, /MODULE_KIR_SYMBOL_CATALOG_FORMAT = 'kern\.symbol-admission\.r1\.5c\.3'/u);
});
