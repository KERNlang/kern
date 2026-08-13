import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '@kernlang/core/runtime/handler';

import { type KernCheckerAssets, loadKernCheckerAssets } from './kern-checker-assets.js';
import {
  estimateKernCheckerNativeWork,
  KERN_CHECKER_RESULT_FORMAT,
  KERN_CHECKER_TABLES,
  validateKernCheckerFacts,
} from './kern-checker-contract.js';

const NATIVE_RESULT_FORMAT = 'kern.checker.native-result.1';
const textEncoder = new TextEncoder();

export interface KernCheckerResult {
  readonly checker: { readonly bytes: number; readonly sha256: string } | null;
  readonly diagnostics: readonly (string | { readonly code: string; readonly message: string })[];
  readonly format: typeof KERN_CHECKER_RESULT_FORMAT;
  readonly outcome: 'accept' | 'reject' | 'failure';
  readonly path: string | null;
}

function failure(checker: KernCheckerResult['checker'], code: string, message: string): KernCheckerResult {
  return {
    checker,
    diagnostics: [{ code, message }],
    format: KERN_CHECKER_RESULT_FORMAT,
    outcome: 'failure',
    path: null,
  };
}

function acceptDiagnostic(path: string): string {
  return `${path}:1:1|T10_MODULE|accept|ok`;
}

function isRejectDiagnostic(line: string, path: string): boolean {
  const prefix = `${path}:`;
  if (!line.startsWith(prefix)) return false;
  return /^-?\d+:-?\d+\|T10_[A-Z0-9_]+\|reject\|[^|\r\n]*$/u.test(line.slice(prefix.length));
}

export function runKernCheckerFacts(
  input: unknown,
  options: { readonly assets?: KernCheckerAssets } = {},
): KernCheckerResult {
  let checker: KernCheckerResult['checker'] = null;
  try {
    const assets = options.assets ?? loadKernCheckerAssets();
    checker = assets.checker;
    const facts = validateKernCheckerFacts(input, assets.policy);
    if (
      estimateKernCheckerNativeWork(facts, assets.policy.nativeWork.maxNativeWork) >
      assets.policy.nativeWork.maxNativeWork
    ) {
      return failure(checker, 'checker-native-work-limit', 'checker input exceeds maxNativeWork');
    }
    const path = facts.path;
    const envelope = executeKernRuntimeHandlerSync(
      {
        abi: KERN_RUNTIME_HANDLER_ABI,
        arguments: [
          facts.format,
          facts.path,
          ...KERN_CHECKER_TABLES.map(([name]) => facts.tables[name]),
          assets.policy.profileLimits.maxRowsPerFamily,
          assets.policy.profileLimits.maxFactCells,
          assets.policy.profileLimits.maxDiagnostics,
        ],
        identity: { handlerName: 'checkFacts', sourcePath: '@kernlang/cli/dist/kern-checker/checker.composed.kern' },
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
      return failure(checker, 'checker-runtime-failure', 'KERN checker runtime did not return a silent list');
    }
    const fields = envelope.result.value.value.map((value, index) => {
      if (value.tag !== 'text') throw new TypeError(`result field ${index} is not text`);
      return value.value;
    });
    if (fields.length < 3 || fields[0] !== NATIVE_RESULT_FORMAT) {
      return failure(checker, 'checker-malformed-result', 'KERN checker returned an unsupported result envelope');
    }
    if (fields[1] === 'failure') {
      return failure(checker, fields[2] || 'checker-native-failure', 'KERN checker rejected the facts contract');
    }
    if (fields[1] !== 'accept' && fields[1] !== 'reject') {
      return failure(checker, 'checker-malformed-result', 'KERN checker returned an invalid outcome');
    }
    const diagnostics = fields.slice(2);
    const exactAccept = diagnostics.length === 1 && diagnostics[0] === acceptDiagnostic(path);
    const exactReject = diagnostics.length > 0 && diagnostics.every((line) => isRejectDiagnostic(line, path));
    if (
      diagnostics.length > assets.policy.profileLimits.maxDiagnostics ||
      (fields[1] === 'accept' && !exactAccept) ||
      (fields[1] === 'reject' && !exactReject)
    ) {
      return failure(checker, 'checker-malformed-result', 'KERN checker outcome does not match its diagnostic tape');
    }
    const result: KernCheckerResult = {
      checker,
      diagnostics,
      format: KERN_CHECKER_RESULT_FORMAT,
      outcome: fields[1],
      path,
    };
    if (textEncoder.encode(JSON.stringify(result)).length > assets.policy.profileLimits.maxResultBytes) {
      return failure(checker, 'checker-result-limit', 'checker result exceeds maxResultBytes');
    }
    return result;
  } catch (error) {
    return failure(checker, 'checker-contract-failure', error instanceof Error ? error.message : String(error));
  }
}

export function kernCheckerExitCode(result: KernCheckerResult): 0 | 1 | 2 {
  if (result.outcome === 'accept') return 0;
  if (result.outcome === 'reject') return 1;
  return 2;
}
