import { isDeepStrictEqual } from 'node:util';
import type { VerifiedKernProjection } from '@kernlang/core/frontend-projection';
import { executeKernKir, KERN_KIR_RUNTIME_FORMAT, type KernKirRequest } from '@kernlang/core/runtime/kir';
import { executeJavaScriptChild, executePythonChild } from './child-execution.js';
import { compileShadowTargets } from './compile-report.js';
import { KIR_SHADOW_LIMITS } from './limits.js';
import { normalizeEnvelope } from './normalize.js';
import type { KirShadowEntry, NormalizedEnvelope } from './types.js';

interface ExecutionReport {
  readonly normalized: NormalizedEnvelope;
}

export async function buildRunReport(
  projection: VerifiedKernProjection,
  projectionArtifactSha256: string,
  entry: KirShadowEntry,
): Promise<{
  readonly outcome: 'match' | 'mismatch';
  readonly report: {
    readonly entry: KirShadowEntry;
    readonly executions: {
      readonly javascriptEsm: ExecutionReport;
      readonly python: ExecutionReport;
      readonly rt1: ExecutionReport;
    };
    readonly projection: { readonly artifactSha256: string; readonly status: 'projected' };
  };
}> {
  const request: KernKirRequest = {
    arguments: {},
    control: { preCancelled: false, timeoutMs: null },
    entry,
    format: KERN_KIR_RUNTIME_FORMAT,
    limits: KIR_SHADOW_LIMITS,
    requestId: 'kern-cli-kir-shadow',
  };
  const { compilations } = compileShadowTargets(projection, entry, projectionArtifactSha256);
  const rt1 = normalizeEnvelope(await executeKernKir(projection, request));
  const javascriptEsm = executeJavaScriptChild(compilations.javascriptEsm, request);
  const python = executePythonChild(compilations.python, request);
  const outcome = isDeepStrictEqual(rt1, javascriptEsm) && isDeepStrictEqual(rt1, python) ? 'match' : 'mismatch';
  return {
    outcome,
    report: {
      entry,
      executions: {
        javascriptEsm: { normalized: javascriptEsm },
        python: { normalized: python },
        rt1: { normalized: rt1 },
      },
      projection: { artifactSha256: projectionArtifactSha256, status: 'projected' },
    },
  };
}
