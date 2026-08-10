import { readFileSync } from 'node:fs';

import { loadFrontendEvolvedHintsPolicy } from '../kern-frontend-evolved-hints/policy.mjs';

const SOURCE = readFileSync(new URL('./policy.json', import.meta.url));
const HEADER_FIELDS = 12;
const WRITE_FIELDS = 8;
const SEAL_FIELDS = 12;
const CATALOG = Object.freeze([
  'fn', 'let', 'return', 'throw', 'do', 'if', 'while', 'doc', 'theme', 'import', 'island', 'route', 'params',
  'auth', 'validate', 'error', 'derive', 'guard', 'effect', 'strategy', 'trigger', 'respond', 'expect', 'rule',
  'message', 'middleware',
]);

function fail(detail) {
  throw new TypeError(`frontend keyword-handler policy rejection: ${detail}`);
}

export function validateFrontendKeywordHandlerPolicy(extension, inherited = loadFrontendEvolvedHintsPolicy()) {
  if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) fail('policy must be a record');
  const expected = ['format', 'handlerCatalog', 'maxEnvelopeBytes', 'maxEnvelopeFields', 'sourceProfile'];
  const keys = Object.keys(extension).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(`policy must contain exactly ${expected.join(',')}`);
  }
  if (extension.format !== 'kern.frontend.keyword-handler-shadow.1') fail('format is unsupported');
  if (
    !Array.isArray(extension.handlerCatalog) || extension.handlerCatalog.length !== CATALOG.length ||
    extension.handlerCatalog.some((name, index) => name !== CATALOG[index]) ||
    new Set(extension.handlerCatalog).size !== CATALOG.length
  ) fail('handlerCatalog must match the closed ordered handler catalog');
  if (extension.sourceProfile !== 'parser-normalized-logical-line-v1') fail('sourceProfile is unsupported');
  if (!Number.isSafeInteger(extension.maxEnvelopeBytes) || extension.maxEnvelopeBytes <= 0) {
    fail('maxEnvelopeBytes must be a positive safe integer');
  }
  if (extension.maxEnvelopeBytes > inherited.runtimeLimits.maxBytes) fail('maxEnvelopeBytes exceeds runtime bytes');
  if (!Number.isSafeInteger(extension.maxEnvelopeFields) || extension.maxEnvelopeFields <= 0) {
    fail('maxEnvelopeFields must be a positive safe integer');
  }
  if (extension.maxEnvelopeFields > inherited.runtimeLimits.maxCollectionLength) {
    fail('maxEnvelopeFields exceeds runtime collection limit');
  }
  const maxWrites = inherited.profileLimits.maxTokens;
  const maxLocalEnvelopeFields = HEADER_FIELDS + maxWrites * WRITE_FIELDS + SEAL_FIELDS;
  if (maxLocalEnvelopeFields > extension.maxEnvelopeFields) fail('local envelope exceeds configured field limit');
  return {
    ...inherited,
    keywordHandlerFormat: extension.format,
    keywordHandlerCatalog: Object.freeze([...extension.handlerCatalog]),
    keywordHandlerSourceProfile: extension.sourceProfile,
    maxKeywordHandlerEnvelopeBytes: extension.maxEnvelopeBytes,
    maxKeywordHandlerEnvelopeFields: extension.maxEnvelopeFields,
    maxKeywordHandlerLocalEnvelopeFields: maxLocalEnvelopeFields,
    maxKeywordHandlerWrites: maxWrites,
  };
}

export function loadFrontendKeywordHandlerPolicy() {
  return validateFrontendKeywordHandlerPolicy(JSON.parse(SOURCE.toString('utf8')));
}
