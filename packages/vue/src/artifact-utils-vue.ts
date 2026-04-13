/**
 * Shared utilities for building multi-file artifacts from Vue structure plans.
 *
 * Used by Vue transpilers when structure !== 'flat' to convert
 * a StructurePlan into GeneratedArtifact[].
 */

import type { GeneratedArtifact, IRNode, ResolvedKernConfig } from '@kernlang/core';
import type { PlannedFile, StructurePlan } from './structure-vue.js';
import {
  extractComposables,
  generateBarrelCode,
  generateLogicComposableCode,
  generateStateComposableCode,
  generateTypesCode,
} from './structure-vue.js';

export interface StructuredResult {
  entryCode: string;
  artifacts: GeneratedArtifact[];
}

/**
 * Build artifacts from a Vue structure plan.
 *
 * @param plan - The structure plan from planVueStructure()
 * @param renderFile - Callback to render a single file's nodes to SFC code
 * @param root - The root IR node
 * @param config - Resolved config
 */
export function buildVueStructuredArtifacts(
  plan: StructurePlan,
  renderFile: (file: PlannedFile, config: ResolvedKernConfig) => string,
  root: IRNode,
  config: ResolvedKernConfig,
): StructuredResult {
  const featureName = (root.props?.name as string) || 'Component';
  const artifacts: GeneratedArtifact[] = [];
  let entryCode = '';

  // Collect state and logic nodes from root children
  const stateNodes: IRNode[] = [];
  const logicNodes: IRNode[] = [];
  for (const child of root.children || []) {
    if (child.type === 'state') stateNodes.push(child);
    if (child.type === 'logic' || child.type === 'handler') logicNodes.push(child);
  }

  // Determine composables directory from plan
  const composableFiles = plan.files.filter((f) => f.artifactType === 'hook');
  const composablesDir =
    composableFiles.length > 0
      ? composableFiles[0].path.substring(0, composableFiles[0].path.lastIndexOf('/'))
      : 'composables';

  const composables = extractComposables(featureName, stateNodes, logicNodes, composablesDir);

  for (const file of plan.files) {
    if (file.artifactType === 'hook') {
      const matchingComposable = composables.find((c) => c.path === file.path);
      if (matchingComposable) {
        const code =
          matchingComposable.stateDecls.length > 0
            ? generateStateComposableCode(matchingComposable)
            : generateLogicComposableCode(
                matchingComposable,
                composables.find((c) => c.stateDecls.length > 0)?.composableName,
              );
        artifacts.push({ path: file.path, content: code, type: 'hook' });
      }
      continue;
    }

    if (file.artifactType === 'types') {
      const stateDecls = stateNodes.map((n) => ({
        name: (n.props?.name as string) || 'value',
        initial: String(n.props?.initial ?? ''),
      }));
      const code = generateTypesCode(featureName, stateDecls);
      artifacts.push({ path: file.path, content: code, type: 'types' });
      continue;
    }

    if (file.artifactType === 'theme') {
      const themeNodes = file.nodes;
      const themeLines: string[] = [];
      for (const tn of themeNodes) {
        const name = (tn.props?.name as string) || 'theme';
        const styles = (tn.props?.styles as Record<string, string>) || {};
        themeLines.push(`export const ${name} = ${JSON.stringify(styles, null, 2)};`);
      }
      artifacts.push({ path: file.path, content: themeLines.join('\n\n'), type: 'theme' });
      continue;
    }

    // Render component/entry/page/template files (SFCs)
    const code = renderFile(file, config);

    if (file.isEntry) {
      entryCode = code;
      artifacts.push({ path: file.path, content: code, type: file.artifactType });
    } else {
      artifacts.push({ path: file.path, content: code, type: file.artifactType });
    }
  }

  // Barrel exports
  for (const barrel of plan.barrels) {
    const code = generateBarrelCode(barrel);
    artifacts.push({ path: barrel.path, content: code, type: 'barrel' });
  }

  return { entryCode, artifacts };
}
