import { createHash } from 'node:crypto';

function fail(milestone, message) {
  throw new TypeError(`${milestone} historical source rejection: ${message}`);
}

export function reconstructHistoricalSource({
  currentSource,
  expectedDigest,
  milestone,
  replacements,
}) {
  if (typeof expectedDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(expectedDigest)) {
    fail(milestone, 'expected digest must be lowercase SHA-256');
  }
  if (!Array.isArray(replacements) || replacements.length === 0) {
    fail(milestone, 'replacements must be a non-empty ordered array');
  }
  let source = Buffer.from(currentSource).toString('utf8');
  source = source
    .replaceAll('maxIterations: iterationBudget', 'maxCollectionLength: iterationBudget')
    .replaceAll('  maxIterations: 65_536,\n', '');
  for (const [index, replacement] of replacements.entries()) {
    if (
      replacement === null ||
      typeof replacement !== 'object' ||
      Array.isArray(replacement) ||
      Reflect.ownKeys(replacement).length !== 2 ||
      typeof replacement.current !== 'string' ||
      replacement.current.length === 0 ||
      typeof replacement.historical !== 'string'
    ) {
      fail(milestone, `replacements[${index}] must contain exact current and historical text`);
    }
    const first = source.indexOf(replacement.current);
    const last = source.lastIndexOf(replacement.current);
    if (first < 0 || first !== last) {
      fail(milestone, `replacements[${index}].current must occur exactly once`);
    }
    source = `${source.slice(0, first)}${replacement.historical}` +
      source.slice(first + replacement.current.length);
  }
  const bytes = Buffer.from(source);
  if (createHash('sha256').update(bytes).digest('hex') !== expectedDigest) {
    fail(milestone, 'reconstructed bytes must match the archived digest');
  }
  return bytes;
}

const SHARED_LIMIT_KEY_IMPORT = `import {
  INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS,
  type InternalRuntimeEnvelope,
  type InternalRuntimeEnvelopeLimits,
  type InternalRuntimeValue,
} from './runtime-envelope/types.js';`;

const HISTORICAL_LIMIT_KEY_IMPORT = `import type {
  InternalRuntimeEnvelope,
  InternalRuntimeEnvelopeLimits,
  InternalRuntimeValue,
} from './runtime-envelope/types.js';`;

const HISTORICAL_HANDLER_LIMIT_KEYS = `const LIMIT_KEYS = [
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents',
  'maxStringBytes',
] as const;`;

const SHARED_LIMIT_KEY_DECLARATION = `export const INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS = [
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents',
  'maxStringBytes',
] as const;

`;

const HISTORICAL_VALUE_LIMIT_KEYS =
  "  const keys = ['maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxStringBytes'];";

export function reconstructRuntimeEnvelopeMaxIterationsSource(currentSource) {
  const source = Buffer.from(currentSource).toString('utf8')
    .replace(SHARED_LIMIT_KEY_IMPORT, HISTORICAL_LIMIT_KEY_IMPORT)
    .replace('const LIMIT_KEYS = INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS;', HISTORICAL_HANDLER_LIMIT_KEYS)
    .replace('  const keys = INTERNAL_RUNTIME_ENVELOPE_LIMIT_KEYS;', HISTORICAL_VALUE_LIMIT_KEYS)
    .replaceAll('  readonly maxIterations: number;\n', '')
    .replaceAll("  'maxIterations',\n", '')
    .replaceAll('    maxIterations: limits.maxIterations as number,\n', '')
    .replace(SHARED_LIMIT_KEY_DECLARATION, '');
  return Buffer.from(source);
}
