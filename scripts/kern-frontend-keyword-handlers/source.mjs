import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MEMBER_URLS = [
  new URL('../../examples/kern-frontend/keyword-handlers-structured-scanner.kern', import.meta.url),
  new URL('../../examples/kern-frontend/keyword-handlers-structured.kern', import.meta.url),
  new URL('../../examples/kern-frontend/keyword-handler-normalization.kern', import.meta.url),
  new URL('../../examples/kern-frontend/keyword-handlers-simple.kern', import.meta.url),
  new URL('../../examples/kern-frontend/keyword-handlers-envelope.kern', import.meta.url),
  new URL('../../examples/kern-frontend/keyword-handlers-composed.kern', import.meta.url),
];

function fail(category, detail) {
  throw new Error(`${category}: ${detail}`);
}

function readRegularSource(url) {
  const path = fileURLToPath(url);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('source containment', `${path} must be a regular file`);
  const source = readFileSync(path, 'utf8');
  if (source.includes('\r')) fail('source containment', `${path} must use LF line endings`);
  if (source.split('\n').length - 1 >= 500) fail('source containment', `${path} must stay below 500 lines`);
  return source;
}

export function validateNativeKeywordHandlerSource(source) {
  for (const forbidden of [
    'KEYWORD_HANDLERS', 'TokenStream', 'tokenizeLineInternal', 'parseLine', 'parseDocument',
    'normalizeKeywordHandlerOracle', 'executeKernRuntimeHandler', 'crypto',
  ]) if (source.includes(forbidden)) fail('delegation rejection', `M4.170 source contains ${forbidden}`);
  if (/^[\t ]*capability\b/gmu.test(source)) fail('delegation rejection', 'M4.170 source contains a capability node');
  const declarations = [...source.matchAll(/^fn name=([^\t ]+)([^\r\n]*)$/gmu)];
  const exported = declarations.filter(([, , tail]) => /\bexport=true\b/u.test(tail));
  if (exported.length !== 1 || exported[0][1] !== 'observekeywordhandlerscomposed') {
    fail('composition rejection', 'observekeywordhandlerscomposed must be the only exported member');
  }
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length !== declarations.length || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'all M4.170 handlers must be native KERN');
  }
  const occurrences = (needle) => source.split(needle).length - 1;
  if (occurrences('observeretainedtokenstream(') !== 3) {
    fail('composition rejection', 'M4.170 must invoke one local, one composed-original, and one masked retained stream');
  }
  if (occurrences('observeevolvedhints(') !== 1) {
    fail('composition rejection', 'M4.170 must invoke M4.169 exactly once');
  }
  if (occurrences('observekeywordhandlers(') !== 1) {
    fail('composition rejection', 'M4.170 must invoke the selected local handler exactly once');
  }
  if (occurrences('normalizekeywordhandlerwrites(') !== 1) {
    fail('composition rejection', 'the neutral keyword normalizer must have exactly one adapter call');
  }
  if (occurrences('observegenericpropertystylethemediagnostics(') !== 1) {
    fail('composition rejection', 'M4.170 must invoke the residual generic continuation exactly once');
  }
  const hintsIndex = source.indexOf('let name=hints value="observeevolvedhints(');
  const handlerIndex = source.indexOf('let name=local value="observekeywordhandlers(');
  const continuationIndex = source.indexOf(
    'let name=continuation value="observegenericpropertystylethemediagnostics(',
  );
  if (!(hintsIndex >= 0 && hintsIndex < handlerIndex && handlerIndex < continuationIndex)) {
    fail('composition rejection', 'M4.170 phase order must be hints then handler then generic continuation');
  }
  return source;
}

export function loadKeywordHandlerMemberSource() {
  return validateNativeKeywordHandlerSource(MEMBER_URLS.map(readRegularSource).join('\n\n'));
}
