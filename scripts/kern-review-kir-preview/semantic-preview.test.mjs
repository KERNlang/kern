import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const REVIEW_ENTRY = new URL('../../packages/review/dist/index.js', import.meta.url);
const PROJECTION_ENTRY = new URL('../../packages/core/dist/frontend-projection.js', import.meta.url);
const PREVIEW_SOURCE = new URL('../../packages/review/src/kir-preview/', import.meta.url);
const PRIVATE_F5_WORKER_URL = new URL('../kern-frontend-f5-projection/worker.mjs', import.meta.url);
const execFileAsync = promisify(execFile);
const FORBIDDEN_REVIEW_REACHABILITY = /\b(?:parseWithDiagnostics|reviewKernSource|inferFromSource|ts-morph|parseDocumentStrict|encodeModuleKir|projectStructuralNode|deriveModuleGraph|parseExpression)\b/u;
const FORBIDDEN_PREVIEW_IMPORT = /(?:^|[/@.-])(?:parser|ts-morph)(?:[/.-]|$)|\b(?:parseWithDiagnostics|reviewKernSource|inferFromSource|parseDocumentStrict|encodeModuleKir|projectStructuralNode|deriveModuleGraph|parseExpression)\b/u;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const TARGET_PROFILE = deepFreeze({
  format: 'kern.review.target-profile.1',
  id: 'kern.review.target.default.v1',
  version: 1,
  unsupportedCapabilities: ['browser/clipboardWrite'],
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const TARGET_PROFILE_DIGEST = createHash('sha256').update(canonicalJson(TARGET_PROFILE)).digest('hex');

function previewSourceFiles() {
  return readdirSync(PREVIEW_SOURCE, { recursive: true })
    .filter((entry) => String(entry).endsWith('.ts'))
    .map((entry) => join(PREVIEW_SOURCE.pathname, String(entry)));
}

function staticImportSpecifiers(source) {
  return [...source.matchAll(/\b(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/gu)]
    .map((match) => match[1]);
}

function resolveLocalImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const candidate = resolve(dirname(importer), specifier);
  const extensions = extname(candidate) ? [''] : ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];
  const paths = [
    ...extensions.map((extension) => `${candidate}${extension}`),
    ...extensions.filter(Boolean).map((extension) => join(candidate, `index${extension}`)),
  ];
  return paths.find((path) => existsSync(path)) ?? null;
}

function assertNoLegacyImportClosure() {
  const pending = previewSourceFiles();
  const visited = new Set();
  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, FORBIDDEN_REVIEW_REACHABILITY,
      `${file} must not reconstruct KIR through legacy, parser, or bootstrap helpers`);
    assert.doesNotMatch(source, /\bimport\s*\(/u,
      `${file} must not hide legacy ownership behind a dynamic import`);
    for (const specifier of staticImportSpecifiers(source)) {
      assert.doesNotMatch(specifier, FORBIDDEN_PREVIEW_IMPORT,
        `${file} must not import parser, legacy inference, or bootstrap reconstruction helpers`);
      const imported = resolveLocalImport(file, specifier);
      if (imported) pending.push(imported);
    }
  }
  assert.ok(visited.size >= previewSourceFiles().length,
    'the import-closure trap must inspect every KIR preview source file');
}

function dynamicallyConstructedDualModules(resultValue) {
  const moduleId = `${['generated', 'dual-identity'].join('/')}.kern`;
  const functionName = ['independent', 'Receipt'].join('');
  return Object.freeze([Object.freeze({
    moduleId,
    source: [
      `fn name=${functionName} returns=string export=true`,
      '  handler lang="kern"',
      `    return value=${JSON.stringify(resultValue)}`,
      '',
    ].join('\n'),
  })]);
}

function dynamicallyConstructedMultiFacetModules() {
  const base = Object.freeze([
    Object.freeze({
      moduleId: `${['generated', 'multi-api'].join('/')}.kern`,
      source: [
        'use path="./models"',
        '  from name=getUser kind=fn as=getUser',
        '',
        'fn name=main returns=string export=true',
        '  handler lang="kern"',
        '    capability namespace=db operation=read name=user',
        '    return value="fetchUser(\\"a\\")"',
        '',
        'fn name=effects export=true',
        '  handler lang="kern"',
        '    throw value="new Error(\\"readUsers\\")"',
        '',
        'class name=Dashboard export=true',
        '  field name=route value="7"',
        '',
      ].join('\n'),
    }),
    Object.freeze({
      moduleId: `${['generated', 'models'].join('/')}.kern`,
      source: 'fn name=getUser returns=string export=true\n  handler lang="kern"\n    return value="id"\n',
    }),
  ]);
  const head = Object.freeze([
    Object.freeze({
      moduleId: `${['generated', 'multi-api'].join('/')}.kern`,
      source: [
        'use path="./accounts"',
        '  from name=getAccount kind=fn as=getAccount',
        '',
        'fn name=main returns=number export=true',
        '  handler lang="kern"',
        '    capability namespace=db operation=write name=user',
        '    capability namespace=browser operation=clipboardWrite name=write',
        '    return value="fetchAccount(\\"b\\")"',
        '',
        'fn name=effects export=true',
        '  handler lang="kern"',
        '    throw value="new Error(\\"writeUsers\\")"',
        '',
        'class name=Dashboard export=true',
        '  field name=route value="8"',
        '',
      ].join('\n'),
    }),
    Object.freeze({
      moduleId: `${['generated', 'accounts'].join('/')}.kern`,
      source: 'fn name=getAccount returns=number export=true\n  handler lang="kern"\n    return value="id"\n',
    }),
  ]);
  return Object.freeze({ base, head });
}

async function privateF5Projection(modules) {
  const input = JSON.stringify(modules);
  const childSource = [
    `import { runProjection } from ${JSON.stringify(PRIVATE_F5_WORKER_URL.href)};`,
    `const modules = JSON.parse(${JSON.stringify(input)});`,
    'const result = runProjection(modules);',
    'process.stdout.write(JSON.stringify({',
    '  receipt: result.receipt,',
    "  bytes: result.bytes === null ? null : Buffer.from(result.bytes).toString('base64'),",
    '}));',
  ].join('\n');
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !key.startsWith('KERN_') && !['NODE_OPTIONS', 'NODE_V8_COVERAGE'].includes(key)));
  const { stdout, stderr } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', childSource], {
    env: environment,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  });
  assert.equal(stderr, '', 'private F5 child must not leak diagnostics into semantic comparison');
  return JSON.parse(stdout);
}

async function previewSurface() {
  const review = await import(REVIEW_ENTRY.href);
  let projection;
  try {
    projection = await import(PROJECTION_ENTRY.href);
  } catch (error) {
    assert.fail(`missing KIR frontend projection subpath: ${error.message}`);
  }
  for (const [owner, name] of [
    [review, 'compareCanonicalKir'],
    [review, 'reviewKernModuleSets'],
    [projection, 'projectKernModules'],
    [projection, 'verifyKernProjection'],
  ]) {
    assert.equal(typeof owner[name], 'function', `missing KIR preview API: ${name}`);
  }
  return { review, projection };
}

async function fixtures() {
  const fixtureModule = await import('./fixtures.mjs');
  assert.ok(Array.isArray(fixtureModule.KIR_REVIEW_FIXTURES), 'fixtures must be a frozen fixture array');
  return fixtureModule.KIR_REVIEW_FIXTURES;
}

function fixtureById(rows, id) {
  const fixture = rows.find((row) => row.id === id);
  assert.ok(fixture, `missing fixture ${id}`);
  return fixture;
}

async function verified(projection, modules) {
  const request = { modules };
  const result = await projection.projectKernModules(request);
  assert.equal(result.status, 'projected', 'comparison inputs must be authenticated projections');
  const verification = projection.verifyKernProjection(request, result);
  assert.equal(typeof verification?.then, 'function', 'verifyKernProjection must be asynchronous');
  return await verification;
}

function findingsOf(result) {
  assert.ok(result && typeof result === 'object', 'comparison must return a structured result');
  assert.ok(Array.isArray(result.findings), 'comparison must expose findings directly');
  return result.findings;
}

function assertComplete(result) {
  assert.equal(result.status, 'complete', 'a valid KIR comparison must complete without legacy fallback');
  assert.ok(result.evidence && typeof result.evidence === 'object', 'complete result must carry evidence');
}

test('KRI-A4: compareCanonicalKir accepts verified projections only and preview source has no legacy ownership', async () => {
  const { review, projection } = await previewSurface();
  const rows = await fixtures();
  const moduleFixture = fixtureById(rows, 'module-added-removed');
  const raw = await projection.projectKernModules({ modules: moduleFixture.base });

  await assert.rejects(
    Promise.resolve().then(() => review.compareCanonicalKir(raw, raw)),
    /verified|projection|brand/i,
    'decodable or raw projection values must not be accepted by the direct Review API',
  );

  const sourceFiles = previewSourceFiles();
  assert.ok(sourceFiles.length > 0, 'KIR preview must live in the isolated review/src/kir-preview boundary');
  assertNoLegacyImportClosure();
});

test('KRI-A5: every KIR semantic facet produces a facet-labelled change', async () => {
  const { review, projection } = await previewSurface();
  const rows = await fixtures();
  const semanticRows = rows.filter((row) => row.expected.change !== 'none' && row.expected.change !== undefined);

  for (const fixture of semanticRows) {
    const base = await verified(projection, fixture.base);
    const head = await verified(projection, fixture.head);
    const result = await review.compareCanonicalKir(base, head, fixture.invocation);
    assertComplete(result);
    const findings = findingsOf(result);
    for (const facet of fixture.facets) {
      const expected = fixture.expected;
      assert.ok(findings.some((finding) => finding.facet === facet &&
        finding.change === expected.change &&
        (expected.key === undefined || finding.key === expected.key) &&
        (expected.before === undefined || finding.before === expected.before) &&
        (expected.after === undefined || finding.after === expected.after)),
      `${fixture.id} must expose its exact ${facet} change, key, and before/after evidence`);
    }
  }
});

test('KRI-A5 target compatibility uses an immutable explicit profile and records its target identity and digest', async () => {
  const { review, projection } = await previewSurface();
  const fixture = fixtureById(await fixtures(), 'target-compatibility');
  assert.equal(Object.isFrozen(TARGET_PROFILE), true, 'target profile is immutable');
  assert.equal(Object.isFrozen(TARGET_PROFILE.unsupportedCapabilities), true, 'target profile collections are immutable');
  const result = await review.compareCanonicalKir(
    await verified(projection, fixture.base),
    await verified(projection, fixture.head),
    { ...fixture.invocation, targetProfile: TARGET_PROFILE },
  );
  assertComplete(result);
  assert.equal(result.evidence.target, TARGET_PROFILE.id, 'evidence binds the selected target identity');
  assert.deepEqual(result.evidence.targetProfile, TARGET_PROFILE, 'evidence carries the explicit immutable profile');
  assert.equal(result.evidence.targetProfileDigest, TARGET_PROFILE_DIGEST,
    'evidence carries the canonical SHA-256 digest of the selected target profile');
  assert.ok(findingsOf(result).some((finding) => finding.facet === 'target-compatibility' &&
    finding.change === fixture.expected.change && finding.key === fixture.expected.key),
  'target incompatibility is derived from the supplied profile rather than a fabricated label');
});

test('KRI-A5 generated accepted module sets expose every affected KIR facet in one comparison', async () => {
  const generated = dynamicallyConstructedMultiFacetModules();
  const [privateBase, privateHead] = await Promise.all([
    privateF5Projection(generated.base),
    privateF5Projection(generated.head),
  ]);
  for (const [label, result] of [['base', privateBase], ['head', privateHead]]) {
    assert.equal(result.receipt.status, 'projected', `generated multi-facet ${label} is accepted by private F5`);
    assert.equal(typeof result.bytes, 'string', `generated multi-facet ${label} returns base64 KIR evidence`);
  }
  const { review, projection } = await previewSurface();
  const result = await review.compareCanonicalKir(
    await verified(projection, generated.base),
    await verified(projection, generated.head),
    { targetProfile: TARGET_PROFILE },
  );
  assertComplete(result);
  const expectedFacets = [
    'public-api', 'imports', 'dependencies', 'capabilities', 'calls', 'effects', 'structure', 'target-compatibility',
  ];
  const presentFacets = new Set(findingsOf(result).map((finding) => finding.facet));
  for (const facet of expectedFacets) {
    assert.equal(presentFacets.has(facet), true,
      `generated multi-facet comparison must retain ${facet} instead of partially passing through KIR`);
  }
});

test('KRI-A6: formatting-only source changes have equal semantic models and no findings', async () => {
  const { review, projection } = await previewSurface();
  const fixture = fixtureById(await fixtures(), 'formatting-only');
  const result = await review.compareCanonicalKir(
    await verified(projection, fixture.base),
    await verified(projection, fixture.head),
  );

  assertComplete(result);
  assert.equal(findingsOf(result).length, 0, 'comments and whitespace must not create KIR semantic changes');
  assert.equal(result.equalSemantics, true, 'formatting-only comparison must make semantic equality explicit');
});

test('KRI-A7: repeated and permuted requests keep findings and fingerprints byte-stable', async () => {
  const { review } = await previewSurface();
  const fixture = fixtureById(await fixtures(), 'module-added-removed');
  const request = { base: { modules: fixture.base }, head: { modules: fixture.head }, mode: 'canonical-kir-preview' };
  const permuted = {
    base: { modules: [...fixture.base].reverse() },
    head: { modules: [...fixture.head].reverse() },
    mode: 'canonical-kir-preview',
  };

  const [first, repeated, reordered] = await Promise.all([
    review.reviewKernModuleSets(request),
    review.reviewKernModuleSets(request),
    review.reviewKernModuleSets(permuted),
  ]);
  for (const result of [first, repeated, reordered]) assertComplete(result);
  const serialized = [first, repeated, reordered].map((result) => JSON.stringify(findingsOf(result)));
  assert.equal(serialized[0], serialized[1], 'repeated comparisons must be byte-stable');
  assert.equal(serialized[0], serialized[2], 'input module ordering must not change finding order or fingerprints');
  for (const finding of findingsOf(first)) {
    assert.equal(typeof finding.fingerprint, 'string', 'every canonical finding needs a deterministic fingerprint');
  }
});

test('KRI-A8: canonical projection failure is explicit, typed, and has no inferred removals', async () => {
  const { review } = await previewSurface();
  const fixture = fixtureById(await fixtures(), 'projection-rejection-malformed');
  const result = await review.reviewKernModuleSets({
    base: { modules: fixture.base },
    head: { modules: fixture.head },
    mode: 'canonical-kir-preview',
  });

  assert.equal(result.status, 'failed');
  assert.equal(findingsOf(result).length, 0, 'missing canonical evidence must never imply a removal');
  assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length > 0, 'failure needs typed diagnostics');
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === fixture.expected.diagnosticCode));
});

test('KRI-A9: dual mode labels independent outputs and never fills canonical failure from legacy success', async () => {
  const { review } = await previewSurface();
  const fixture = fixtureById(await fixtures(), 'dual-failure-no-fallback');
  const result = await review.reviewKernModuleSets({
    base: { modules: fixture.base },
    head: { modules: fixture.head },
    mode: 'dual-compare',
  });

  assert.equal(result.status, fixture.expected.overall);
  assert.equal(result.canonical.status, fixture.expected.canonical.status);
  assert.equal(findingsOf(result.canonical).length, 0);
  assert.equal(result.legacy.status, fixture.expected.legacy.status);
  assert.ok(result.divergence, 'dual mode must make canonical/legacy disagreement visible');
  assert.notEqual(result.canonical, result.legacy, 'dual results must retain independent identities');
});

test('KRI-A9: dual output binds canonical request and artifact identities to its generated input while keeping legacy separate', async () => {
  const { review, projection } = await previewSurface();
  const baseModules = dynamicallyConstructedDualModules('before');
  const headModules = dynamicallyConstructedDualModules('after');
  const [baseProjection, headProjection, result] = await Promise.all([
    projection.projectKernModules({ modules: baseModules }),
    projection.projectKernModules({ modules: headModules }),
    review.reviewKernModuleSets({
      base: { modules: baseModules },
      head: { modules: headModules },
      mode: 'dual-compare',
    }),
  ]);
  assert.equal(baseProjection.status, 'projected', 'generated dual base is projectable');
  assert.equal(headProjection.status, 'projected', 'generated dual head is projectable');
  assertComplete(result.canonical);
  assert.equal(result.canonical.analysisMode, 'canonical-kir-preview', 'canonical output has its own label');
  assert.equal(result.legacy.analysisMode, 'legacy-source', 'legacy output has its own label');
  assert.notEqual(result.canonical, result.legacy, 'dual outputs remain distinct values');
  for (const [side, projectionResult] of [['base', baseProjection], ['head', headProjection]]) {
    assert.equal(result.canonical.evidence[side].requestDigest, projectionResult.receipt.requestDigest,
      `${side} canonical evidence binds its exact generated module-set identity`);
    assert.equal(result.canonical.evidence[side].artifactDigest, projectionResult.receipt.artifactDigest,
      `${side} canonical evidence binds its exact generated KIR identity`);
  }
});
