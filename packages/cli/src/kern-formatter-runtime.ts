import { createHash } from 'node:crypto';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '@kernlang/core/runtime/handler';

import { type KernFormatterAssets, loadKernFormatterAssets } from './kern-formatter-assets.js';
import {
  KERN_FORMATTER_RESULT_FORMAT,
  safeKernFormatterErrorMessage,
  validateKernFormatterRequest,
} from './kern-formatter-contract.js';
import {
  createKernFormatterPhysicalRecords,
  KernFormatterPhysicalRecordError,
} from './kern-formatter-physical-records.js';

const NATIVE_RESULT_FORMAT = 'kern.formatter.native-result.1';
const textEncoder = new TextEncoder();

export interface KernFormatterResult {
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
  readonly edits: number | null;
  readonly format: typeof KERN_FORMATTER_RESULT_FORMAT;
  readonly formatter: { readonly bytes: number; readonly sha256: string } | null;
  readonly outcome: 'formatted' | 'failure';
  readonly source: string | null;
  readonly sourceSha256: string | null;
}

function failure(formatter: KernFormatterResult['formatter'], code: string, message: string): KernFormatterResult {
  return {
    diagnostics: [{ code, message }],
    edits: null,
    format: KERN_FORMATTER_RESULT_FORMAT,
    formatter,
    outcome: 'failure',
    source: null,
    sourceSha256: null,
  };
}

export function runKernFormatter(
  input: unknown,
  options: { readonly assets?: KernFormatterAssets } = {},
): KernFormatterResult {
  let formatter: KernFormatterResult['formatter'] = null;
  try {
    const assets = options.assets ?? loadKernFormatterAssets();
    formatter = assets.formatter;
    const request = validateKernFormatterRequest(input, assets.policy.profileLimits);
    const limits = assets.policy.profileLimits;
    const physicalRecords = createKernFormatterPhysicalRecords(request.source, limits);
    const envelope = executeKernRuntimeHandlerSync(
      {
        abi: KERN_RUNTIME_HANDLER_ABI,
        arguments: [
          request.source,
          physicalRecords,
          limits.maxCodePoints,
          limits.maxRecords,
          limits.maxRecordCodePoints,
          limits.maxLexicalDepth,
          limits.maxResultCodePoints,
        ],
        identity: {
          handlerName: 'formatsource',
          sourcePath: '@kernlang/cli/dist/kern-formatter/formatter.composed.kern',
        },
        source: assets.source,
      },
      { enabled: true, limits: assets.policy.runtimeLimits },
    );
    if (
      envelope.outcome !== 'success' ||
      envelope.completion.kind !== 'return' ||
      envelope.events.length !== 0 ||
      envelope.result.presence !== 'value' ||
      envelope.result.value.tag !== 'list'
    ) {
      return failure(formatter, 'formatter-runtime-failure', 'KERN formatter did not return a silent list');
    }
    const fields = envelope.result.value.value.map((value, index) => {
      if (value.tag !== 'text') throw new TypeError(`result field ${index} is not text`);
      return value.value;
    });
    if (fields.length !== 4 || fields[0] !== NATIVE_RESULT_FORMAT) {
      return failure(formatter, 'formatter-malformed-result', 'KERN formatter returned an unsupported result tape');
    }
    if (fields[1] === 'failure') return failure(formatter, fields[2] || 'formatter-native-failure', fields[3]);
    if (fields[1] !== 'formatted' || !/^(0|[1-9][0-9]*)$/u.test(fields[2])) {
      return failure(formatter, 'formatter-malformed-result', 'KERN formatter returned an invalid outcome');
    }
    const edits = Number(fields[2]);
    if (!Number.isSafeInteger(edits)) return failure(formatter, 'formatter-malformed-result', 'edit count is unsafe');
    const source = fields[3];
    const sourceSha256 = createHash('sha256').update(source).digest('hex');
    const result: KernFormatterResult = {
      diagnostics: [],
      edits,
      format: KERN_FORMATTER_RESULT_FORMAT,
      formatter,
      outcome: 'formatted',
      source,
      sourceSha256,
    };
    if (textEncoder.encode(JSON.stringify(result)).length > limits.maxResultBytes) {
      return failure(formatter, 'formatter-result-limit', 'formatter result exceeds maxResultBytes');
    }
    return result;
  } catch (error) {
    if (error instanceof KernFormatterPhysicalRecordError) return failure(formatter, error.code, error.detail);
    return failure(formatter, 'formatter-contract-failure', safeKernFormatterErrorMessage(error));
  }
}

export function kernFormatterExitCode(result: KernFormatterResult): 0 | 2 {
  return result.outcome === 'formatted' ? 0 : 2;
}
