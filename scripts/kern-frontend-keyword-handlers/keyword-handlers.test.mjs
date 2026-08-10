import assert from 'node:assert/strict';
import test from 'node:test';

import { KernRuntime } from '../../packages/core/dist/runtime-state.js';
import {
  consumeMutableNodeTypeRegistryParseEvidence,
  parseWithGenericPropertyLoopSafety,
} from '../../packages/core/dist/mutable-node-type-registry-snapshot.js';
import {
  executeComposedFields,
  evaluateKeywordHandlers,
  evaluateLocalKeywordHandler,
  loadKeywordHandlerMemberSource,
  loadKeywordHandlerSource,
  parseComposedKeywordHandlerEnvelope,
  validateNativeKeywordHandlerSource,
} from '../check-kern-frontend-keyword-handlers.mjs';
import { normalizeRetainedTokenStreamOracle } from '../kern-frontend-retained-token-stream/oracle.mjs';
import {
  KEYWORD_HANDLER_CATALOG,
  KEYWORD_HANDLER_EDGE_FIXTURES,
  KEYWORD_HANDLER_FALLBACK_FIXTURES,
  KEYWORD_HANDLER_FIXTURES,
  KEYWORD_HANDLER_NUMERIC_FIXTURES,
} from './fixtures.mjs';
import {
  loadFrontendKeywordHandlerPolicy,
  validateFrontendKeywordHandlerPolicy,
} from './policy.mjs';
import { normalizeKeywordHandlerOracle } from './oracle.mjs';

const policy = loadFrontendKeywordHandlerPolicy();
const nativeSource = loadKeywordHandlerSource();

function compositionCapture(content, runtime = new KernRuntime(), effectivePolicy = policy) {
  const evidence = parseWithGenericPropertyLoopSafety(content, runtime, {
    maxNameBytes: effectivePolicy.maxNameBytes,
    maxNameCodePoints: effectivePolicy.maxNameCodePoints,
    maxRegistryEntries: effectivePolicy.maxRegistryEntries,
  });
  const captured = consumeMutableNodeTypeRegistryParseEvidence(evidence);
  return {
    fields: executeComposedFields(content, captured.snapshot, effectivePolicy, nativeSource),
    snapshot: captured.snapshot,
  };
}

function mutateAuthenticatedMemberField(fields, tag, memberIndex, replacement) {
  const mutated = [...fields];
  for (let cursor = 21; cursor < mutated.length - 20; cursor += 20) {
    if (mutated[cursor] !== tag) continue;
    const start = Number(mutated[cursor + 2]);
    const count = Number(mutated[cursor + 3]);
    if (memberIndex >= start && memberIndex < start + count) {
      mutated[cursor + 4 + memberIndex - start] = replacement;
      return mutated;
    }
  }
  throw new Error(`missing ${tag} member field ${memberIndex}`);
}

function diagnosticShape({ category, code, col, endCol, line, message, severity, suggestion }) {
  return { category, code, col, endCol, line, message, severity, suggestion };
}

function bootstrapDiagnostics(result) {
  return result.bootstrapParseResult.diagnostics
    .filter(({ code }) => ['DUPLICATE_PROP', 'UNEXPECTED_TOKEN'].includes(code))
    .map(diagnosticShape);
}

test('fixture contract covers the closed 26-entry handler catalog exactly once', () => {
  assert.equal(KEYWORD_HANDLER_CATALOG.length, 26);
  assert.deepEqual(KEYWORD_HANDLER_FIXTURES.map(({ type }) => type), KEYWORD_HANDLER_CATALOG);
  assert.deepEqual(policy.keywordHandlerCatalog, KEYWORD_HANDLER_CATALOG);
});

test('policy is closed, bounded, and rejects catalog or field drift', () => {
  const extension = {
    format: policy.keywordHandlerFormat,
    handlerCatalog: [...policy.keywordHandlerCatalog],
    maxEnvelopeBytes: policy.maxKeywordHandlerEnvelopeBytes,
    maxEnvelopeFields: policy.maxKeywordHandlerEnvelopeFields,
    sourceProfile: policy.keywordHandlerSourceProfile,
  };
  assert.deepEqual(validateFrontendKeywordHandlerPolicy(extension).keywordHandlerCatalog, KEYWORD_HANDLER_CATALOG);
  assert.throws(
    () => validateFrontendKeywordHandlerPolicy({ ...extension, handlerCatalog: extension.handlerCatalog.slice(1) }),
    /handlerCatalog/u,
  );
  assert.throws(
    () => validateFrontendKeywordHandlerPolicy({ ...extension, maxEnvelopeFields: 1 }),
    /local envelope/u,
  );
  assert.throws(
    () => validateFrontendKeywordHandlerPolicy({ ...extension, extra: true }),
    /must contain exactly/u,
  );
});

function oracleResult(fixture) {
  const stream = normalizeRetainedTokenStreamOracle(fixture.source, policy);
  const typeIndex = stream.tokens.findIndex(({ kind }) => kind !== 'whitespace');
  assert.equal(stream.tokens[typeIndex]?.kind, 'identifier', fixture.id);
  assert.equal(stream.tokens[typeIndex].value, fixture.type, fixture.id);
  return normalizeKeywordHandlerOracle(fixture.source, fixture.type, stream, typeIndex + 1);
}

test('independent oracle matches every authored positive and fallback contract', () => {
  for (const fixture of [
    ...KEYWORD_HANDLER_FIXTURES,
    ...KEYWORD_HANDLER_FALLBACK_FIXTURES,
    ...KEYWORD_HANDLER_EDGE_FIXTURES,
    ...KEYWORD_HANDLER_NUMERIC_FIXTURES,
  ]) {
    assert.deepEqual(oracleResult(fixture).props, fixture.expectedHandlerProps, fixture.id);
  }
});

test('native KERN owns one positive contract for every catalog handler', () => {
  for (const fixture of KEYWORD_HANDLER_FIXTURES) {
    const actual = evaluateLocalKeywordHandler(fixture.source, policy, nativeSource);
    assert.deepEqual(actual.handlerProps, fixture.expectedHandlerProps, fixture.id);
  }
});

test('composed native KERN preserves local and final property contracts across the closed catalog', () => {
  for (const fixture of KEYWORD_HANDLER_FIXTURES) {
    const actual = evaluateKeywordHandlers(fixture.source, new KernRuntime(), policy, nativeSource);
    assert.deepEqual(actual.handlerProps, fixture.expectedHandlerProps, `${fixture.id}: local`);
    assert.deepEqual(
      actual.finalProps,
      fixture.expectedFinalProps ?? fixture.expectedHandlerProps,
      `${fixture.id}: final`,
    );
    if (fixture.id === 'fn-first-class') assert.equal(actual.bootstrapParity, 'compared');
    if (fixture.id === 'throw-raw') assert.equal(actual.bootstrapParity, 'out-of-scope-tree');
    if (fixture.id === 'import-named') {
      assert.equal(actual.bootstrapParity, 'out-of-scope-canonicalization');
    }
  }
});

test('native KERN preserves every authored no-op, raw fallback, and rewind outcome', () => {
  for (const fixture of KEYWORD_HANDLER_FALLBACK_FIXTURES) {
    const actual = evaluateLocalKeywordHandler(fixture.source, policy, nativeSource);
    assert.deepEqual(actual.handlerProps, fixture.expectedHandlerProps, fixture.id);
  }
});

test('native KERN matches nested, encoded, Unicode, multiline-logical, and numeric edge contracts', () => {
  for (const fixture of [...KEYWORD_HANDLER_EDGE_FIXTURES, ...KEYWORD_HANDLER_NUMERIC_FIXTURES]) {
    const expected = oracleResult(fixture);
    const actual = evaluateLocalKeywordHandler(fixture.source, policy, nativeSource);
    assert.deepEqual(actual.handlerProps, fixture.expectedHandlerProps, fixture.id);
    assert.equal(actual.initialCursor, expected.initialCursor, `${fixture.id}: initial cursor`);
    assert.equal(actual.finalCursor, expected.finalCursor, `${fixture.id}: final cursor`);
  }
});

test('M4.170 owns a committing handler before the residual generic loop', () => {
  const fixture = KEYWORD_HANDLER_FIXTURES.find(({ id }) => id === 'route-method-path');
  assert.ok(fixture);
  const actual = evaluateKeywordHandlers(
    fixture.source,
    new KernRuntime(),
    policy,
    nativeSource,
  );
  assert.equal(actual.status, 'decision');
  assert.equal(actual.bootstrapParity, 'compared');
  assert.deepEqual(actual.handlerProps, fixture.expectedHandlerProps);
  assert.deepEqual(actual.finalProps, fixture.expectedFinalProps);
  assert.equal(actual.cursorDecision, fixture.cursorDecision);
});

test('runtime positional hints run before the selected handler and preserve the residual generic continuation', () => {
  const runtime = new KernRuntime();
  runtime.registerParserHints('route', { positionalArgs: ['slot'] });
  const actual = evaluateKeywordHandlers('route GET /users name=listUsers', runtime, policy, nativeSource);
  assert.deepEqual(actual.handlerProps, {});
  assert.deepEqual(actual.finalProps, { slot: 'GET', name: 'listUsers' });
  assert.deepEqual(actual.diagnostics.map(({ code }) => code), ['UNEXPECTED_TOKEN']);
  assert.deepEqual(actual.diagnostics.map(diagnosticShape), bootstrapDiagnostics(actual));
  assert.deepEqual(actual.bootstrapParseResult.root.props, actual.finalProps);
});

test('legacy import fallback commits positional writes before generic continuation', () => {
  const actual = evaluateKeywordHandlers(
    'import default Widget mode=lazy', new KernRuntime(), policy, nativeSource,
  );
  assert.deepEqual(actual.handlerProps, { default: true, name: 'Widget' });
  assert.deepEqual(actual.finalProps, { default: true, name: 'Widget', mode: 'lazy' });
  assert.equal(actual.bootstrapParity, 'compared');
});

test('seeded handler and export collisions emit ordered DUPLICATE_PROP evidence before last-write-wins', () => {
  const handlerCollision = evaluateKeywordHandlers(
    'route GET /users method=post name=listUsers', new KernRuntime(), policy, nativeSource,
  );
  assert.deepEqual(handlerCollision.finalProps, { method: 'post', path: '/users', name: 'listUsers' });
  assert.deepEqual(handlerCollision.seedDuplicates.map(({ key }) => key), ['method']);
  assert.deepEqual(handlerCollision.diagnostics.map(({ code }) => code), ['DUPLICATE_PROP']);
  assert.deepEqual(handlerCollision.diagnostics.map(diagnosticShape), bootstrapDiagnostics(handlerCollision));
  assert.deepEqual(handlerCollision.bootstrapParseResult.root.props, handlerCollision.finalProps);

  const exportCollision = evaluateKeywordHandlers(
    'fn export=false', new KernRuntime(), policy, nativeSource, { exported: true },
  );
  assert.deepEqual(exportCollision.handlerProps, {});
  assert.deepEqual(exportCollision.finalProps, { export: 'false' });
  assert.deepEqual(exportCollision.seedDuplicates.map(({ key }) => key), ['export']);
  assert.deepEqual(exportCollision.diagnostics.map(({ code }) => code), ['DUPLICATE_PROP']);
  assert.deepEqual(exportCollision.diagnostics.map(diagnosticShape), bootstrapDiagnostics(exportCollision));
  assert.deepEqual(exportCollision.bootstrapParseResult.root.props, exportCollision.finalProps);
});

test('handler masking preserves generic properties, quoted metadata, styles, pseudo-styles, and theme refs', () => {
  const actual = evaluateKeywordHandlers(
    'route GET /users label="hello" {bg:red,:press:fg:white} $base',
    new KernRuntime(), policy, nativeSource,
  );
  assert.deepEqual(actual.finalProps, {
    method: 'get',
    path: '/users',
    label: 'hello',
    styles: { bg: 'red' },
    pseudoStyles: { press: { fg: 'white' } },
    themeRefs: ['base'],
  });
  assert.deepEqual(actual.quotedProps, ['label']);
  assert.deepEqual(actual.bootstrapParseResult.root.props, actual.finalProps);
  assert.deepEqual(actual.bootstrapParseResult.root.__quotedProps, actual.quotedProps);
  assert.deepEqual(actual.diagnostics.map(diagnosticShape), bootstrapDiagnostics(actual));
});

test('handler masking preserves UTF-16 width and astral content through the residual continuation', () => {
  const content = 'route GET /🚀 label="launch 🚀"';
  const actual = evaluateKeywordHandlers(
    content, new KernRuntime(), policy, nativeSource,
  );
  assert.deepEqual(actual.handlerProps, { method: 'get', path: '/🚀' });
  assert.deepEqual(actual.finalProps, { method: 'get', path: '/🚀', label: 'launch 🚀' });
  assert.equal(actual.maskedContent.length, content.length);
  assert.deepEqual(actual.bootstrapParseResult.root.props, actual.finalProps);
});

test('authenticated composition is deterministic and every authenticated region rejects tampering', () => {
  const content = 'route GET /users name=listUsers';
  const capture = compositionCapture(content);
  const replay = executeComposedFields(content, capture.snapshot, policy, nativeSource);
  assert.deepEqual(replay, capture.fields);
  assert.equal(
    parseComposedKeywordHandlerEnvelope(content, capture.snapshot, capture.fields, policy).status,
    'decision',
  );

  for (const tag of ['hints-auth', 'local-auth', 'masked-stream-auth', 'continuation-auth']) {
    const mutated = [...capture.fields];
    const index = mutated.indexOf(tag);
    assert.notEqual(index, -1, tag);
    mutated[index + 4] = `${mutated[index + 4]}-tampered`;
    assert.throws(
      () => parseComposedKeywordHandlerEnvelope(content, capture.snapshot, mutated, policy),
      /envelope rejection/u,
      tag,
    );
  }
  const sealMutation = [...capture.fields];
  sealMutation[sealMutation.length - 19] = `${content}-tampered`;
  assert.throws(
    () => parseComposedKeywordHandlerEnvelope(content, capture.snapshot, sealMutation, policy),
    /envelope rejection/u,
    'terminal seal',
  );
  assert.throws(
    () => parseComposedKeywordHandlerEnvelope(
      content,
      { ...capture.snapshot, parseEpoch: capture.snapshot.parseEpoch + 1 },
      capture.fields,
      policy,
    ),
    /envelope rejection/u,
    'stale parse epoch',
  );
});

test('authenticated local payloads reject canonical typed-value mutations', () => {
  const content = 'expect codegen value=true';
  const capture = compositionCapture(content);
  const booleanValueField = 12 + 4;
  const mutated = mutateAuthenticatedMemberField(
    capture.fields, 'local-auth', booleanValueField, 'garbage',
  );
  assert.throws(
    () => parseComposedKeywordHandlerEnvelope(content, capture.snapshot, mutated, policy),
    /envelope rejection/u,
  );
});

test('composition rejects a native handler-mask source mutation', () => {
  const maskCall = 'let name=maskedContent value="maskkeywordhandlerstream(content, hintMaskedContent, stream, initialCursor, finalCursor, maxCodePoints, streamFormat)"';
  const disabledMaskSource = nativeSource.replace(
    maskCall,
    'let name=maskedContent value=hintMaskedContent',
  );
  assert.notEqual(disabledMaskSource, nativeSource);
  assert.throws(
    () => evaluateKeywordHandlers(
      'route GET /users name=listUsers', new KernRuntime(), policy, disabledMaskSource,
    ),
    /envelope rejection/u,
    'handler mask mutation',
  );

});

test('composition rejects a native seeded-duplicate source mutation', () => {
  const duplicateCall = 'let name=duplicates value="keywordhandlerseedduplicates(hints, local, maskedStream, exported, maxHandlerWrites, maxCodePoints, hintsFormat, handlerFormat, streamFormat)"';
  const disabledDuplicateSource = nativeSource.replace(duplicateCall, 'let name=duplicates value="[]"');
  assert.notEqual(disabledDuplicateSource, nativeSource);
  assert.throws(
    () => evaluateKeywordHandlers(
      'route GET /users method=post name=listUsers', new KernRuntime(), policy, disabledDuplicateSource,
    ),
    /envelope rejection/u,
    'seeded duplicate mutation',
  );
});

test('composed native KERN closes field and byte exhaustion with compact authenticated failures', () => {
  const content = 'route GET /users name=listUsers';
  const baseline = compositionCapture(content);
  const fieldPolicy = { ...policy, maxKeywordHandlerEnvelopeFields: 100 };
  const fieldFields = executeComposedFields(content, baseline.snapshot, fieldPolicy, nativeSource);
  assert.deepEqual(
    parseComposedKeywordHandlerEnvelope(content, baseline.snapshot, fieldFields, fieldPolicy),
    {
      code: 'KEYWORD_HANDLER_FIELDS_LIMIT',
      detail: '',
      format: policy.keywordHandlerFormat,
      status: 'failure',
    },
  );

  const baselineBytes = Buffer.byteLength(baseline.fields.join(''), 'utf8');
  const bytePolicy = {
    ...policy,
    maxKeywordHandlerEnvelopeBytes: Math.max(512, Math.floor(baselineBytes / 2)),
  };
  const byteFields = executeComposedFields(content, baseline.snapshot, bytePolicy, nativeSource);
  assert.deepEqual(
    parseComposedKeywordHandlerEnvelope(content, baseline.snapshot, byteFields, bytePolicy),
    {
      code: 'KEYWORD_HANDLER_BYTES_LIMIT',
      detail: '',
      format: policy.keywordHandlerFormat,
      status: 'failure',
    },
  );

  const writePolicy = { ...policy, maxKeywordHandlerWrites: 1 };
  const writeFields = executeComposedFields(content, baseline.snapshot, writePolicy, nativeSource);
  assert.deepEqual(
    parseComposedKeywordHandlerEnvelope(content, baseline.snapshot, writeFields, writePolicy),
    {
      code: 'KEYWORD_HANDLER_LOCAL_INVALID',
      detail: '',
      format: policy.keywordHandlerFormat,
      status: 'failure',
    },
  );
});

test('source containment rejects delegation, foreign handlers, call-count drift, and extra exports', () => {
  const source = loadKeywordHandlerMemberSource();
  assert.equal(validateNativeKeywordHandlerSource(source), source);
  assert.throws(
    () => validateNativeKeywordHandlerSource(`${source}\ncapability name=escape`),
    /delegation rejection/u,
  );
  assert.throws(
    () => validateNativeKeywordHandlerSource(source.replace('handler lang="kern"', 'handler lang="js"')),
    /delegation rejection/u,
  );
  assert.throws(
    () => validateNativeKeywordHandlerSource(source.replace('observeretainedtokenstream(', 'retainedstreammutant(')),
    /composition rejection/u,
  );
  assert.throws(
    () => validateNativeKeywordHandlerSource(source.replace('observekeywordhandlers(', 'keywordhandlermutant(')),
    /composition rejection/u,
  );
  assert.throws(
    () => validateNativeKeywordHandlerSource(`${source}\nfn name=escape export=true\n  handler lang="kern"\n    return value=0`),
    /composition rejection/u,
  );
});
