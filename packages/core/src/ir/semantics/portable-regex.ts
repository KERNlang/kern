import {
  expandRegexIFold,
  normalizeRegexClasses,
  REGEX_TEST_G_FAILCLOSE,
  regexIFoldFailMessage,
  regexLiteralReceiverIR,
  scanRegexAstral,
} from '../../codegen/regex-normalize.js';
import type { ValueIR } from '../../value-ir.js';
import type { SemanticEnv } from './index.js';
import { evalPortableValue } from './portable-scalar.js';

export const REGEXP_VALUE_TAG: unique symbol = Symbol('kern.regexpValue');

export interface RegExpValue {
  readonly [REGEXP_VALUE_TAG]: true;
  readonly pattern: string;
  readonly flags: string;
}

export function makeRegExpValue(pattern: string, flags: string): RegExpValue {
  return Object.freeze({ [REGEXP_VALUE_TAG]: true as const, pattern, flags });
}

export function isRegExpValue(value: unknown): value is RegExpValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [REGEXP_VALUE_TAG]?: unknown })[REGEXP_VALUE_TAG] === true &&
    typeof (value as { pattern?: unknown }).pattern === 'string' &&
    typeof (value as { flags?: unknown }).flags === 'string'
  );
}

const RUNNER_REGEX_TEST_FLAGS = new Set(['i', 'm', 's', 'g']);

function hasOnlyRunnerRegexTestFlags(flags: string): boolean {
  return Array.from(flags).every((flag) => RUNNER_REGEX_TEST_FLAGS.has(flag));
}

function hasBareDotWithoutDotAll(pattern: string): boolean {
  const chars = Array.from(pattern);
  let inClass = false;
  let escaped = false;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (!inClass && ch === '.') return true;
  }

  return false;
}

export function isRegexTestExpression(node: ValueIR): boolean {
  if (node.kind !== 'call') return false;
  if (node.callee.kind !== 'member' || node.callee.property !== 'test') return false;
  const regex = regexLiteralReceiverIR(node.callee.object);
  if (regex === null) return false;
  if (node.args.length !== 1) return false;
  if (!hasOnlyRunnerRegexTestFlags(regex.flags)) return false;

  const normalizedPattern = normalizeRegexClasses(regex.pattern);
  if (!regex.flags.includes('s') && hasBareDotWithoutDotAll(normalizedPattern)) return false;
  if (scanRegexAstral(normalizedPattern) !== null) return false;

  return true;
}

export function evalRegexTestExpression(node: ValueIR, env: SemanticEnv): boolean {
  if (node.kind !== 'call' || node.callee.kind !== 'member') {
    throw new Error('portable-regex: expected regex.test(...) call');
  }
  const regex = regexLiteralReceiverIR(node.callee.object);
  if (regex === null) {
    throw new Error('portable-regex: expected regex literal receiver');
  }
  const { pattern, flags } = regex;
  if (flags.includes('g')) {
    throw new Error(REGEX_TEST_G_FAILCLOSE);
  }

  const arg = evalPortableValue(node.args[0], env);
  if (typeof arg !== 'string') {
    throw new Error('portable-regex: .test argument must evaluate to a string');
  }

  const folded = expandRegexIFold(normalizeRegexClasses(pattern), flags);
  if ('failClose' in folded) {
    throw new Error(regexIFoldFailMessage(folded.char, folded.reason));
  }
  return new RegExp(folded.pattern, flags).test(arg);
}

export function isRunnerNativeRegexFailClose(error: unknown): boolean {
  return error instanceof Error && error.message === REGEX_TEST_G_FAILCLOSE;
}
