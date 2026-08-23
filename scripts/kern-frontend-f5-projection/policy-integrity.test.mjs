import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  COMPOSITION_PATHS, MAPPING_PATHS, loadPinned, sha256, validatePolicy,
} from './policy-validation.mjs';

const ROOT = new URL('../../', import.meta.url);
const POLICY = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));

function clone() {
  return structuredClone(POLICY);
}

function rejects(mutator, pattern = /F5 projection policy/u) {
  const candidate = clone();
  mutator(candidate);
  assert.throws(() => validatePolicy(candidate), pattern);
}

test('A1/A12 policy pins exact private formats, mapping identities, composition, and F4 identity', () => {
  const policy = validatePolicy(clone());
  assert.equal(policy.format, 'kern.frontend.f5-projection-policy.1');
  assert.equal(policy.resultFormat, 'kern.frontend.f5-projection.1');
  assert.equal(policy.documentFormat, 'kern.frontend.f4-document.2');
  assert.equal(policy.moduleSetFormat, 'kern.frontend.f4-module-set.4');
  assert.deepEqual(policy.mappingAuthorities.map(({ path }) => path), MAPPING_PATHS);
  assert.deepEqual(policy.composition.map(({ path }) => path), COMPOSITION_PATHS);
  assert.equal(policy.f4Policy.path, 'scripts/kern-frontend-f4-declarations/policy.json');
  for (const descriptor of [policy.f4Policy, ...policy.mappingAuthorities, ...policy.composition]) {
    assert.equal(descriptor.sha256, sha256(readFileSync(new URL(descriptor.path, ROOT), 'utf8')),
      descriptor.path);
  }
  assert.equal(loadPinned(policy, ROOT).size, 1 + MAPPING_PATHS.length + COMPOSITION_PATHS.length);
});

test('A1 descriptor deletion, duplication, reorder, substitution, and digest drift fail closed', () => {
  rejects((p) => p.mappingAuthorities.pop(), /descriptor counts/u);
  rejects((p) => p.mappingAuthorities.splice(1, 0, structuredClone(p.mappingAuthorities[0])), /descriptor counts/u);
  rejects((p) => p.mappingAuthorities.reverse(), /mapping 0 identity/u);
  rejects((p) => { p.mappingAuthorities[0].path = MAPPING_PATHS[1]; }, /mapping 0 identity/u);
  rejects((p) => { p.composition[0] = structuredClone(p.composition[1]); }, /composition 0 identity/u);
  const candidate = clone();
  candidate.f4Policy.sha256 = '0'.repeat(64);
  assert.throws(() => loadPinned(validatePolicy(candidate), ROOT), /digest/u);
});

test('A11 profile and canonical limits reject zero, unsafe, and cross-boundary configurations', () => {
  for (const section of ['profileLimits', 'canonicalLimits', 'runtimeLimits']) {
    const key = Object.keys(POLICY[section])[0];
    rejects((p) => { p[section][key] = 0; }, new RegExp(section.replace('Limits', ' limits'), 'iu'));
    rejects((p) => { p[section][key] = Number.MAX_SAFE_INTEGER + 1; }, /limits/u);
  }
  rejects((p) => { p.profileLimits.maxDepth = p.runtimeLimits.maxDepth + 1; }, /limit relationship/u);
  rejects((p) => { p.canonicalLimits.maxDepth = p.profileLimits.maxDepth + 1; }, /limit relationship/u);
  rejects((p) => { p.profileLimits.maxInstructionScalars = p.runtimeLimits.maxStringBytes + 1; },
    /limit relationship/u);
});

test('A9 composition symbol and production-source canaries detect renamed roots and golden shortcuts', () => {
  const sources = COMPOSITION_PATHS.map((path) => readFileSync(new URL(path, ROOT), 'utf8')).join('\n');
  const scripts = ['worker.mjs', 'decoder.mjs', 'policy-validation.mjs']
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  const rootCanary = (source) => /fn name=projectf5moduleset returns="string\[\]" export=true/u.test(source);
  const shortcutCanary = (source) =>
    /(?:static-goldens|expectedCanonicalBase64|parseDocument|encodeModuleKir|projectStructuralNode)/u.test(source);
  assert.equal(rootCanary(sources), true);
  assert.equal(rootCanary(sources.replace('projectf5moduleset', 'projectf5modulesex')), false);
  assert.equal(shortcutCanary(scripts), false);
  assert.equal(shortcutCanary(`${scripts}\nconst expectedCanonicalBase64 = "corrupt";`), true);
});
