import { isWellFormedText, textCodePoints, textMalformedSurrogateFailMessage } from '../../codegen/text-contract.js';
import type { ValueIR } from '../../value-ir.js';
import {
  assignBinding,
  getBinding,
  hasBinding,
  isIntProvenanced,
  type SemanticEnv,
} from './semantic-env.js';
import { emptyTrace, type Trace } from './trace.js';

export const INTERNAL_TEXT_SPLICE_MAX_CODE_POINTS = 1_000_000;

export interface ParsedInternalMachineTextSplice {
  readonly endName: string;
  /** Compatibility fields keep legacy non-push do narrowing fail-closed. */
  readonly key: ValueIR;
  readonly kind: 'text-splice';
  readonly maxOutputCodePointsName: string;
  readonly replacementName: string;
  readonly startName: string;
  readonly targetName: string;
  readonly value: ValueIR;
}

function bindingName(node: ValueIR, label: string): string {
  if (node.kind !== 'ident') throw new Error(`Text.splice: ${label} must be a direct binding identifier`);
  return node.name;
}

export function parseInternalMachineTextSplice(node: ValueIR): ParsedInternalMachineTextSplice | undefined {
  if (node.kind !== 'call' || node.optional || node.callee.kind !== 'member' || node.callee.optional) return undefined;
  if (node.callee.object.kind !== 'ident' || node.callee.object.name !== 'Text' || node.callee.property !== 'splice') {
    return undefined;
  }
  if (node.args.length !== 5) throw new Error('Text.splice: expected exactly five binding arguments');
  return {
    endName: bindingName(node.args[2], 'end'),
    key: node.args[1],
    kind: 'text-splice',
    maxOutputCodePointsName: bindingName(node.args[4], 'maxOutputCodePoints'),
    replacementName: bindingName(node.args[3], 'replacement'),
    startName: bindingName(node.args[1], 'start'),
    targetName: bindingName(node.args[0], 'target'),
    value: node.args[3],
  };
}

function requireBinding(env: SemanticEnv, name: string, label: string): unknown {
  if (!hasBinding(env, name)) throw new Error(`Text.splice: ${label} binding "${name}" not found`);
  return getBinding(env, name);
}

export function assertInternalMachineTextSplicePreflight(
  parsed: ParsedInternalMachineTextSplice,
  env: SemanticEnv,
  deferredBindings: ReadonlySet<string> = new Set(),
): void {
  if (hasBinding(env, 'Text')) throw new Error('portable machine: namespace "Text" is shadowed');
  const target = requireBinding(env, parsed.targetName, 'target');
  if (typeof target !== 'string' && !deferredBindings.has(parsed.targetName)) {
    throw new Error('Text.splice: target must be a string binding');
  }
  const replacement = requireBinding(env, parsed.replacementName, 'replacement');
  if (typeof replacement !== 'string' && !deferredBindings.has(parsed.replacementName)) {
    throw new Error('Text.splice: replacement must be a string binding');
  }
  for (const [name, label] of [
    [parsed.startName, 'start'],
    [parsed.endName, 'end'],
    [parsed.maxOutputCodePointsName, 'maxOutputCodePoints'],
  ] as const) {
    const value = requireBinding(env, name, label);
    if (
      !(typeof value === 'number' && Number.isSafeInteger(value)) &&
      !isIntProvenanced(env, name) &&
      !deferredBindings.has(name)
    ) {
      throw new Error(`Text.splice: ${label} must be a known, proven, or declared deferred integer`);
    }
  }
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Text.splice: ${label} must be a safe integer`);
  }
  return value;
}

export function runInternalMachineTextSplice(parsed: ParsedInternalMachineTextSplice, env: SemanticEnv): Trace {
  if (hasBinding(env, 'Text')) throw new Error('portable machine: namespace "Text" is shadowed');
  const target = requireBinding(env, parsed.targetName, 'target');
  const replacement = requireBinding(env, parsed.replacementName, 'replacement');
  if (typeof target !== 'string') throw new Error('Text.splice: target must be a string binding');
  if (typeof replacement !== 'string') throw new Error('Text.splice: replacement must be a string binding');
  if (!isWellFormedText(target)) throw new Error(textMalformedSurrogateFailMessage('Text.splice target'));
  if (!isWellFormedText(replacement)) throw new Error(textMalformedSurrogateFailMessage('Text.splice replacement'));

  const start = safeInteger(getBinding(env, parsed.startName), 'start');
  const end = safeInteger(getBinding(env, parsed.endName), 'end');
  const cap = safeInteger(getBinding(env, parsed.maxOutputCodePointsName), 'maxOutputCodePoints');
  if (cap <= 0 || cap > INTERNAL_TEXT_SPLICE_MAX_CODE_POINTS) {
    throw new Error('Text.splice: maxOutputCodePoints exceeds the internal safety boundary');
  }
  const targetPoints = textCodePoints(target);
  if (start < 0 || end < start || end > targetPoints.length) {
    throw new Error('Text.splice: bounds must satisfy 0 <= start <= end <= target length');
  }
  const replacementPoints = textCodePoints(replacement);
  const resultLength = targetPoints.length - (end - start) + replacementPoints.length;
  if (resultLength > cap || resultLength > INTERNAL_TEXT_SPLICE_MAX_CODE_POINTS) {
    throw new Error('Text.splice: result exceeds maxOutputCodePoints');
  }
  const next = [...targetPoints.slice(0, start), ...replacementPoints, ...targetPoints.slice(end)].join('');
  assignBinding(env, parsed.targetName, next);
  return emptyTrace();
}
