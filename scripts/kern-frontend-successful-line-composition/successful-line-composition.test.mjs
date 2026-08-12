import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyLoopSafety,
} from '../../packages/core/dist/mutable-node-type-registry-snapshot.js';
import { KernRuntime } from '../../packages/core/dist/runtime-state.js';
import * as successfulLineChecker from '../check-kern-frontend-successful-line-composition.mjs';
import {
  evaluateSuccessfulLineComposition,
  parseSuccessfulLineEnvelope,
} from '../check-kern-frontend-successful-line-composition.mjs';
import {
  runtimeForSuccessfulLineFixture,
  SUCCESSFUL_LINE_FIXTURES,
} from './fixtures.mjs';
import { assertSuccessfulLineFixture } from './oracle.mjs';
import {
  loadFrontendSuccessfulLinePolicy,
  validateFrontendSuccessfulLinePolicy,
} from './policy.mjs';
import {
  loadSuccessfulLineMemberSource,
  loadSuccessfulLineSource,
  validateNativeSuccessfulLineSource,
} from './source.mjs';

const policy = loadFrontendSuccessfulLinePolicy();
const source = loadSuccessfulLineSource();
const results = new Map();

function resultFor(fixture) {
  if (!results.has(fixture.id)) {
    results.set(fixture.id, evaluateSuccessfulLineComposition(
      fixture.raw,
      runtimeForSuccessfulLineFixture(fixture),
      policy,
      source,
    ));
  }
  return results.get(fixture.id);
}

test('native KERN emits each complete hand-audited successful ParsedLine record', () => {
  for (const fixture of SUCCESSFUL_LINE_FIXTURES) {
    const expected = assertSuccessfulLineFixture(fixture);
    const result = resultFor(fixture);
    assert.equal(result.status, 'decision', fixture.id);
    assert.equal(result.structural.semanticContent, fixture.semanticContent, fixture.id);
    assert.deepEqual(result.line, expected, fixture.id);
    assert.deepEqual(result.diagnostics, fixture.expectedDiagnostics, `${fixture.id}: diagnostics`);
  }
});

test('quotedProps preserves absent versus present instead of normalizing to an empty list', () => {
  assert.equal(Object.hasOwn(resultFor(SUCCESSFUL_LINE_FIXTURES[1]).line, 'quotedProps'), false);
  assert.deepEqual(resultFor(SUCCESSFUL_LINE_FIXTURES[0]).line.quotedProps, ['label']);
});

test('export-seed duplicate diagnostics receive only the outer indentation shift', () => {
  const result = evaluateSuccessfulLineComposition(
    '  export fn export=false',
    new KernRuntime(),
    policy,
    source,
  );
  assert.deepEqual(result.diagnostics, [{
    category: 'parser',
    code: 'DUPLICATE_PROP',
    col: 13,
    endCol: 19,
    line: 1,
    message: "Duplicate property 'export' at line 1",
    severity: 'warning',
    suggestion: 'Remove the duplicate property or merge the values into a single prop assignment.',
  }]);
  assert.deepEqual(result.parseResult.diagnostics, result.diagnostics);
});

test('custom nodes retain first-class-looking generic properties', () => {
  const runtime = new KernRuntime();
  runtime.dynamicNodeTypes.add('widget');
  const result = evaluateSuccessfulLineComposition(
    'widget __firstClassSyntax=yes __firstClassImport=yes __firstClassBindings=yes',
    runtime,
    policy,
    source,
  );
  assert.deepEqual(result.line.props, {
    __firstClassBindings: 'yes',
    __firstClassImport: 'yes',
    __firstClassSyntax: 'yes',
  });
  assert.deepEqual(result.parseResult.root.props, result.line.props);
});

test('custom nodes retain style-and-theme-looking generic properties', () => {
  const runtime = new KernRuntime();
  runtime.dynamicNodeTypes.add('widget');
  const result = evaluateSuccessfulLineComposition(
    'widget styles=compact pseudoStyles=manual themeRefs=night {bg:red,:press:fg:white} $base',
    runtime,
    policy,
    source,
  );
  assert.deepEqual(result.line.props, {
    pseudoStyles: 'manual',
    styles: 'compact',
    themeRefs: 'night',
  });
  assert.deepEqual(result.line.styles, { bg: 'red' });
  assert.deepEqual(result.line.pseudoStyles, { press: { fg: 'white' } });
  assert.deepEqual(result.line.themeRefs, ['base']);
  assert.deepEqual(result.parseResult.root.props, {
    pseudoStyles: { press: { fg: 'white' } },
    styles: { bg: 'red' },
    themeRefs: ['base'],
  });
});

test('policy is closed, bounded, inherited, and rejects operational drift', () => {
  const extension = {
    format: policy.successfulLineFormat,
    maxEnvelopeBytes: policy.maxSuccessfulLineEnvelopeBytes,
    maxEnvelopeFields: policy.maxSuccessfulLineEnvelopeFields,
    sourceProfile: policy.successfulLineSourceProfile,
  };
  assert.equal(validateFrontendSuccessfulLinePolicy(extension).successfulLineFormat, extension.format);
  assert.throws(() => validateFrontendSuccessfulLinePolicy({ ...extension, extra: true }), /exactly/u);
  assert.throws(() => validateFrontendSuccessfulLinePolicy({ ...extension, maxEnvelopeFields: 100 }), /cannot fit/u);
  assert.equal(
    validateFrontendSuccessfulLinePolicy({ ...extension, maxEnvelopeFields: 101 })
      .maxSuccessfulLineEnvelopeFields,
    101,
  );
  assert.throws(() => validateFrontendSuccessfulLinePolicy({ ...extension, maxEnvelopeBytes: 0 }), /byte limit/u);
});

test('raw input bounds are enforced before bootstrap tokenization', () => {
  assert.throws(
    () => evaluateSuccessfulLineComposition('', {}),
    /source rejection: raw must not be empty/u,
  );
  for (const raw of ['text value=x\n', 'text value=x\u2028']) {
    assert.throws(
      () => evaluateSuccessfulLineComposition(raw, {}),
      /source rejection: raw must be one logical line/u,
    );
  }
  const tooManyCodePoints = 'x'.repeat(policy.profileLimits.maxCodePoints + 1);
  assert.throws(
    () => evaluateSuccessfulLineComposition(tooManyCodePoints, {}),
    /source rejection: raw exceeds the code-point limit/u,
  );
  const tooManyBytes = '🚀'.repeat(Math.floor(policy.profileLimits.maxSourceBytes / 4) + 1);
  assert.throws(
    () => evaluateSuccessfulLineComposition(tooManyBytes, {}),
    /source rejection: raw exceeds the UTF-8 byte limit/u,
  );
});

test('unsupported inherited pseudo styles are ignored without mutating the host Object constructor', () => {
  const pollutionKey = 'agonPollutedM4171';
  delete Object[pollutionKey];
  try {
    const result = evaluateSuccessfulLineComposition(
      `screen {:constructor:${pollutionKey}:yes}`,
      runtimeForSuccessfulLineFixture({ id: 'constructor-pseudo-style-containment' }),
      policy,
      source,
    );
    assert.equal(result.status, 'decision');
    assert.deepEqual(result.line.pseudoStyles, {});
    assert.equal(Object[pollutionKey], undefined);
  } finally {
    delete Object[pollutionKey];
  }
});

test('source-profile failures are compact and atomic', () => {
  for (const [id, raw] of [
    ['tab', '\ttext value=x'],
    ['vertical-tab', '\vtext value=x'],
    ['non-breaking-space', '\u00a0text value=x'],
  ]) {
    const failed = evaluateSuccessfulLineComposition(
      raw,
      runtimeForSuccessfulLineFixture({ id: `source-profile-${id}` }),
      policy,
      source,
    );
    assert.equal(failed.status, 'failure', id);
    assert.equal(failed.code, 'SUCCESSFUL_LINE_SOURCE_PROFILE', id);
    assert.equal(failed.detail, '', id);
    assert.equal(failed.envelopeFields.length, 41, id);
  }
});

test('every compact native failure branch is executable and authenticated', () => {
  assert.equal(typeof successfulLineChecker.executeSuccessfulLineFields, 'function');
  const raw = 'text value=x';
  const runtime = runtimeForSuccessfulLineFixture({ id: 'failure-branches' });
  const evidence = parseWithGenericPropertyLoopSafety(raw, runtime, {
    maxNameBytes: policy.maxNameBytes,
    maxNameCodePoints: policy.maxNameCodePoints,
    maxRegistryEntries: policy.maxRegistryEntries,
  });
  const { snapshot } = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  const cases = [
    {
      code: 'SUCCESSFUL_LINE_TRIM_INVALID',
      policy,
      raw: 'x'.repeat(policy.profileLimits.maxCodePoints + 1),
      source,
    },
    {
      code: 'SUCCESSFUL_LINE_CHILD_INVALID',
      policy,
      raw,
      source: source.replace('child[0] != handlerFormat', 'child[0] == handlerFormat'),
    },
  ];
  for (const fixture of cases) {
    const fields = successfulLineChecker.executeSuccessfulLineFields(
      fixture.raw,
      snapshot,
      fixture.policy,
      fixture.source,
    );
    const failed = parseSuccessfulLineEnvelope(fixture.raw, snapshot, fields, fixture.policy);
    assert.equal(failed.status, 'failure', fixture.code);
    assert.equal(failed.code, fixture.code, fixture.code);
    assert.equal(failed.detail, '', fixture.code);
    assert.equal(fields.length, 41, fixture.code);
  }
});

test('native source is closed, native-only, under 500 lines, and owns each predecessor exactly once', () => {
  const member = loadSuccessfulLineMemberSource();
  assert.ok(member.split('\n').length - 1 < 500);
  assert.equal(member.split('observewhitespacetrim(').length - 1, 1);
  assert.equal(member.split('observekeywordhandlerscomposed(').length - 1, 1);
  assert.throws(
    () => validateNativeSuccessfulLineSource(member.replace(
      'observekeywordhandlerscomposed(',
      'observekeywordhandlerscomposed(observekeywordhandlerscomposed(',
    )),
    /exactly once/u,
  );
  assert.throws(
    () => validateNativeSuccessfulLineSource(`${member}\n# parseDocument`),
    /delegation rejection/u,
  );
});

test('structural, epoch, limit, predecessor, diagnostic, and terminal-seal mutations fail closed', () => {
  const fixture = SUCCESSFUL_LINE_FIXTURES[0];
  const baseline = resultFor(fixture);
  const reject = (mutate, pattern = /rejection|drift|invalid|Expected values/u) => {
    const fields = [...baseline.envelopeFields];
    mutate(fields);
    assert.throws(
      () => parseSuccessfulLineEnvelope(fixture.raw, baseline.snapshot, fields, policy),
      pattern,
    );
  };
  reject((fields) => { fields[7] = '0'; });
  reject((fields) => { fields[8] = String(Number(fields[8]) + 1); });
  reject((fields) => { fields[10] = String(Number(fields[10]) + 1); });
  reject((fields) => { fields[13] = String(Number(fields[13]) + 1); });
  reject((fields) => { fields[15] = String(Number(fields[15]) - 1); });
  reject((fields) => { fields[21] = 'seal'; });
  reject((fields) => { fields[23] = '1'; });
  reject((fields) => {
    const index = fields.findIndex((field) => field.startsWith('Unexpected token "stray"'));
    assert.notEqual(index, -1);
    fields[index] = fields[index].replace('stray', 'changed');
  });
  reject((fields) => { fields[fields.length - 20] = 'moved-seal'; });
  reject((fields) => { fields.push('post-seal'); });
});

test('exact envelope bounds succeed and the first field or byte over-limit fails atomically', () => {
  const fixture = SUCCESSFUL_LINE_FIXTURES[0];
  const baseline = resultFor(fixture);
  const exactFields = baseline.envelopeFields.length;
  const bytesAtBound = (fieldBound, byteBound) => {
    const fields = [...baseline.envelopeFields];
    fields[15] = String(fieldBound);
    fields[16] = String(byteBound);
    fields[fields.length - 6] = String(fieldBound);
    fields[fields.length - 5] = String(byteBound);
    return Buffer.byteLength(fields.join(''), 'utf8');
  };
  let exactBytes = Buffer.byteLength(baseline.envelopeFields.join(''), 'utf8');
  while (bytesAtBound(exactFields, exactBytes) !== exactBytes) {
    exactBytes = bytesAtBound(exactFields, exactBytes);
  }
  const exactPolicy = {
    ...policy,
    maxSuccessfulLineEnvelopeBytes: exactBytes,
    maxSuccessfulLineEnvelopeFields: exactFields,
  };
  const evaluateBound = (bounded) => {
    const envelopeFields = successfulLineChecker.executeSuccessfulLineFields(
      fixture.raw,
      baseline.snapshot,
      bounded,
      source,
    );
    return {
      ...parseSuccessfulLineEnvelope(fixture.raw, baseline.snapshot, envelopeFields, bounded),
      envelopeFields,
    };
  };
  const exact = evaluateBound(exactPolicy);
  assert.equal(exact.status, 'decision');
  assert.deepEqual(exact.line, fixture.expected);

  for (const bounded of [
    { ...exactPolicy, maxSuccessfulLineEnvelopeFields: exactFields - 1 },
    { ...exactPolicy, maxSuccessfulLineEnvelopeBytes: exactBytes - 1 },
  ]) {
    const failed = evaluateBound(bounded);
    assert.equal(failed.status, 'failure');
    assert.equal(failed.code, 'SUCCESSFUL_LINE_ENVELOPE_LIMIT');
    assert.equal(failed.detail, '');
    assert.equal(failed.envelopeFields.length, 41);
  }
});

test('astral UTF-16, export shift, inline-comment length, and style/theme separation are explicit', () => {
  const route = resultFor(SUCCESSFUL_LINE_FIXTURES[0]);
  assert.equal(route.line.rawLength, route.structural.retained.length);
  assert.equal([...route.structural.retained].length, route.line.rawLength - 2);
  assert.equal(route.line.loc.col, 3);
  assert.equal(route.line.loc.endCol, 96);
  assert.deepEqual(route.line.styles, { bg: 'red' });
  assert.deepEqual(route.line.pseudoStyles, { press: { fg: 'white' } });
  assert.deepEqual(route.line.themeRefs, ['base', 'accent']);
  assert.equal(Object.hasOwn(route.line.props, 'styles'), false);

  const exported = resultFor(SUCCESSFUL_LINE_FIXTURES[1]);
  assert.equal(exported.exported, true);
  assert.equal(exported.structural.col, 5);
  assert.equal(exported.line.loc.col, 12);
  assert.equal(exported.line.rawLength, 56);
});
