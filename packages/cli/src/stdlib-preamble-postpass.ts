import type { IRNode, KernStdlibUsage, KernTarget, TranspileResult } from '@kernlang/core';
import {
  assertNotPortablePowerHelperBinding,
  detectKernStdlibUsage,
  emittedCodeUsesLooseEq,
  emittedCodeUsesTextOps,
  findTypeScriptSfcScriptBlock,
  injectKernStdlibPreamble,
  injectKernStdlibPreambleIntoSFC,
  KERN_LIST_INDEX_HELPER_TS_NAME,
  KERN_POWER_HELPER_TS_NAME,
  kernStdlibPreamble,
} from '@kernlang/core';
import { getOutputExtension } from './target-output-extension.js';
import {
  analyzeTypeScriptGeneratedHelperUsage,
  type TypeScriptGeneratedSourceKind,
} from './typescript-generated-helper-safety.js';

const TS_FAMILY_TARGETS: ReadonlySet<KernTarget> = new Set<KernTarget>([
  'lib',
  'native',
  'web',
  'tailwind',
  'mcp',
  'express',
  'cli',
  'terminal',
  'ink',
  'nextjs',
]);

const SFC_TARGETS: ReadonlySet<KernTarget> = new Set<KernTarget>(['vue', 'nuxt']);

export function isTypeScriptFamilyTarget(target: KernTarget): boolean {
  return TS_FAMILY_TARGETS.has(target);
}

export function isTsArtifactPath(path: string): boolean {
  return path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.mts') || path.endsWith('.cts');
}

function isSfcArtifactPath(path: string): boolean {
  return path.endsWith('.vue');
}

function powerBearingTypeScript(code: string, isSfc: boolean): string {
  if (!isSfc) return code;
  return findTypeScriptSfcScriptBlock(code)?.content ?? '';
}

function injectForOutput(
  code: string,
  isSfc: boolean,
  sharedUsage: KernStdlibUsage,
  sourceKind: TypeScriptGeneratedSourceKind,
): string {
  const emittedTypeScript = powerBearingTypeScript(code, isSfc);
  const helperUsage = analyzeTypeScriptGeneratedHelperUsage(emittedTypeScript, KERN_POWER_HELPER_TS_NAME, sourceKind);
  const power = helperUsage.calls;
  if (power && helperUsage.bindsOrWrites) {
    assertNotPortablePowerHelperBinding(KERN_POWER_HELPER_TS_NAME);
  }
  const listIndexUsage = analyzeTypeScriptGeneratedHelperUsage(
    emittedTypeScript,
    KERN_LIST_INDEX_HELPER_TS_NAME,
    sourceKind,
  );
  const listIndex = listIndexUsage.calls;
  if (listIndex && listIndexUsage.bindsOrWrites) {
    assertNotPortablePowerHelperBinding(KERN_LIST_INDEX_HELPER_TS_NAME);
  }
  const preamble = kernStdlibPreamble({ ...sharedUsage, listIndex, power });
  return isSfc ? injectKernStdlibPreambleIntoSFC(code, preamble) : injectKernStdlibPreamble(code, preamble);
}

/** Inject shared stdlib declarations, but scope checked power to outputs that call it. */
export function applyKernStdlibPreamble(ast: IRNode, target: KernTarget, result: TranspileResult): TranspileResult {
  const isSfcTarget = SFC_TARGETS.has(target);
  if (!isTypeScriptFamilyTarget(target) && !isSfcTarget) return result;

  const usage = detectKernStdlibUsage(ast);
  if (
    emittedCodeUsesLooseEq(result.code) ||
    (result.artifacts?.some(
      (artifact) => isTsArtifactPath(artifact.path) && emittedCodeUsesLooseEq(artifact.content),
    ) ??
      false)
  ) {
    usage.looseEq = true;
  }
  if (
    emittedCodeUsesTextOps(result.code) ||
    (result.artifacts?.some(
      (artifact) =>
        (isTsArtifactPath(artifact.path) || isSfcArtifactPath(artifact.path)) &&
        emittedCodeUsesTextOps(artifact.content),
    ) ??
      false)
  ) {
    usage.textOps = true;
  }
  const mainSourceKind: TypeScriptGeneratedSourceKind = getOutputExtension(target) === '.tsx' ? 'tsx' : 'ts';
  const updatedCode = injectForOutput(result.code, isSfcTarget, usage, mainSourceKind);
  const updatedArtifacts = result.artifacts?.map((artifact) => {
    if (isSfcArtifactPath(artifact.path)) {
      return { ...artifact, content: injectForOutput(artifact.content, true, usage, 'ts') };
    }
    if (isTsArtifactPath(artifact.path)) {
      const sourceKind: TypeScriptGeneratedSourceKind = artifact.path.endsWith('.tsx') ? 'tsx' : 'ts';
      return { ...artifact, content: injectForOutput(artifact.content, false, usage, sourceKind) };
    }
    return artifact;
  });

  return {
    ...result,
    code: updatedCode,
    ...(updatedArtifacts ? { artifacts: updatedArtifacts } : {}),
  };
}
