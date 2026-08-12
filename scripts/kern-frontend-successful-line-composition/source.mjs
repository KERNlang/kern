import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadKeywordHandlerSource } from '../check-kern-frontend-keyword-handlers.mjs';

const MEMBER_URL = new URL('../../examples/kern-frontend/successful-line-composition.kern', import.meta.url);

function fail(category, detail) {
  throw new Error(`${category}: ${detail}`);
}

export function validateNativeSuccessfulLineSource(source) {
  for (const forbidden of [
    'parseLine', 'parseDocument', 'parseInternal', 'toNode', 'buildTree', 'KEYWORD_HANDLERS',
    'normalizeSuccessfulLine', 'executeKernRuntimeHandler', 'crypto', 'hmac', 'digest',
  ]) if (source.includes(forbidden)) fail('delegation rejection', `M4.171 source contains ${forbidden}`);
  const declarations = [...source.matchAll(/^fn name=([^\t ]+)([^\r\n]*)$/gmu)];
  const expected = ['successfullinefailure', 'successfulwordchar', 'observesuccessfullinecomposition'];
  if (
    declarations.length !== expected.length ||
    declarations.some((match, index) => match[1] !== expected[index]) ||
    declarations.some((match, index) => (
      index === declarations.length - 1 ? !/\bexport=true\b/u.test(match[2]) : /\bexport=true\b/u.test(match[2])
    ))
  ) fail('composition rejection', 'M4.171 function surface must match the closed allowlist');
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length !== declarations.length || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'all M4.171 handlers must be native KERN');
  }
  const occurrences = (needle) => source.split(needle).length - 1;
  if (occurrences('observewhitespacetrim(') !== 1) {
    fail('composition rejection', 'M4.171 must invoke the whitespace-trim owner exactly once');
  }
  if (occurrences('observekeywordhandlerscomposed(') !== 1) {
    fail('composition rejection', 'M4.171 must invoke M4.170 exactly once');
  }
  return source;
}

export function loadSuccessfulLineMemberSource() {
  const path = fileURLToPath(MEMBER_URL);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('source containment', `${path} must be a regular file`);
  const source = readFileSync(path, 'utf8');
  if (source.includes('\r')) fail('source containment', `${path} must use LF line endings`);
  const lines = source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length;
  if (lines >= 500) fail('source containment', `${path} has ${lines} lines; expected fewer than 500`);
  return validateNativeSuccessfulLineSource(source);
}

export function loadSuccessfulLineSource() {
  return `${loadKeywordHandlerSource()}\n\n${loadSuccessfulLineMemberSource()}`;
}
