import type { IRNode, TranspileResult, ResolvedKernConfig, AccountedEntry } from '@kernlang/core';
import { countTokens, serializeIR, buildDiagnostics, accountNode, getProps } from '@kernlang/core';
import { planStructure } from './structure.js';
import type { PlannedFile } from './structure.js';
import { buildStructuredArtifacts } from './artifact-utils.js';
import type { NextFile } from './nextjs-types.js';
import { routeToPath } from './nextjs-style.js';
import { renderAndAssemble } from './nextjs-assembler.js';

/**
 * Next.js App Router Transpiler
 *
 * Extends the Tailwind transpiler with Next.js-specific features:
 * - page / layout / loading / error node types -> file conventions
 * - metadata node -> generateMetadata export
 * - Server vs client components (client=true flag)
 * - next/link, next/image, next/navigation imports
 * - Multi-file output via TranspileResult.files
 */

interface NextTranspileResult extends TranspileResult {
  files: NextFile[];
}

// ── Main export ─────────────────────────────────────────────────────────

export function transpileNextjs(root: IRNode, config?: ResolvedKernConfig): NextTranspileResult {
  // Structured output path
  if (config && config.structure !== 'flat') {
    const plan = planStructure(root, config);
    if (plan) {
      return _transpileNextjsStructured(root, config, plan);
    }
  }
  // Flat output path (default)
  return _transpileNextjsInner(root, config);
}

// ── Flat output ─────────────────────────────────────────────────────────

function _transpileNextjsInner(root: IRNode, config?: ResolvedKernConfig): NextTranspileResult {
  const rootProps = getProps(root);
  const name = (rootProps.name as string) || 'Page';

  const { ctx, code: output } = renderAndAssemble(
    root,
    config,
    name,
    (stateName) => root.children?.find(c => c.type === 'state' && c.props?.name === stateName),
  );

  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(output);
  const tokenReduction = tsTokenCount > 0 ? Math.round((1 - irTokenCount / tsTokenCount) * 100) : 0;

  // Determine output filename convention (route-aware)
  const route = rootProps.route as string | undefined;
  const segment = rootProps.segment as string | undefined;
  const routePrefix = route ? routeToPath(route, segment) : (segment ? routeToPath('', segment) : '');
  const isLayout = root.type === 'layout';
  const isLoading = root.type === 'loading';
  const isError = root.type === 'error';
  const files: NextFile[] = [];
  if (isLayout) files.push({ path: `${routePrefix}layout.tsx`, content: output });
  else if (isLoading) files.push({ path: `${routePrefix}loading.tsx`, content: output });
  else if (isError) files.push({ path: `${routePrefix}error.tsx`, content: output });
  else files.push({ path: `${routePrefix}page.tsx`, content: output });

  const accounted = new Map<IRNode, AccountedEntry>();
  accountNode(accounted, root, 'expressed', undefined, true);
  const CONSUMED = new Set(['state', 'logic', 'on', 'theme', 'handler']);
  for (const child of root.children || []) {
    if (CONSUMED.has(child.type)) accountNode(accounted, child, 'consumed', child.type + ' pre-pass', true);
  }

  return {
    code: output,
    sourceMap: ctx.sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    files,
    diagnostics: buildDiagnostics(root, accounted, 'nextjs'),
  };
}

// ── Structured output ────────────────────────────────────────────────────

function _renderNextjsFile(file: PlannedFile, config: ResolvedKernConfig): string {
  const rootNode = file.rootNode;
  const name = file.componentName || (rootNode.props?.name as string) || 'Component';

  const { code } = renderAndAssemble(
    rootNode,
    config,
    name,
    (stateName) => {
      const firstNode = file.nodes[0];
      return firstNode?.children?.find((c: IRNode) => c.type === 'state' && c.props?.name === stateName);
    },
  );

  return code;
}

function _transpileNextjsStructured(
  root: IRNode,
  config: ResolvedKernConfig,
  plan: import('./structure.js').StructurePlan,
): NextTranspileResult {
  const { entryCode, artifacts } = buildStructuredArtifacts(
    plan,
    (file, cfg) => _renderNextjsFile(file, cfg),
    root,
    config,
  );

  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(entryCode);
  const tokenReduction = tsTokenCount > 0 ? Math.round((1 - irTokenCount / tsTokenCount) * 100) : 0;

  // Convert artifacts to NextFile[] for files property
  const files: NextFile[] = artifacts
    .filter(a => a.path.endsWith('.tsx'))
    .map(a => ({ path: a.path, content: a.content }));

  return {
    code: entryCode,
    sourceMap: [],
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    files,
    artifacts,
    diagnostics: buildDiagnostics(root, new Map<IRNode, AccountedEntry>([[root, { outcome: 'expressed' }]]), 'nextjs'),
  };
}
