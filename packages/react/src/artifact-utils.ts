/**
 * Shared utilities for building multi-file artifacts from structure plans.
 *
 * Used by all 3 React transpilers (Tailwind, Next.js, Web) when
 * structure !== 'flat' to convert a StructurePlan into GeneratedArtifact[].
 */

import type { GeneratedArtifact, IRNode, ResolvedKernConfig } from '@kernlang/core';
import type {
  StructurePlan,
  PlannedFile,
  ExtractedHook,
} from './structure.js';
import {
  extractHooks,
  generateStateHookCode,
  generateLogicHookCode,
  generateTypesCode,
  generateBarrelCode,
} from './structure.js';

export interface StructuredResult {
  entryCode: string;
  artifacts: GeneratedArtifact[];
}

/**
 * Build artifacts from a structure plan.
 *
 * @param plan - The structure plan from planStructure()
 * @param renderFile - Callback to render a single file's nodes to code string.
 *   Receives the planned file, and returns the rendered code for that file.
 * @param root - The root IR node
 * @param config - Resolved config
 */
export function buildStructuredArtifacts(
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

  // Determine hooks directory from plan
  const hookFiles = plan.files.filter(f => f.artifactType === 'hook');
  const hooksDir = hookFiles.length > 0
    ? hookFiles[0].path.substring(0, hookFiles[0].path.lastIndexOf('/'))
    : 'hooks';

  const hooks = extractHooks(featureName, stateNodes, logicNodes, hooksDir);

  for (const file of plan.files) {
    if (file.artifactType === 'hook') {
      // Generate hook code
      const matchingHook = hooks.find(h => h.path === file.path);
      if (matchingHook) {
        const code = matchingHook.stateDecls.length > 0
          ? generateStateHookCode(matchingHook)
          : generateLogicHookCode(
              matchingHook,
              hooks.find(h => h.stateDecls.length > 0)?.hookName,
            );
        artifacts.push({ path: file.path, content: code, type: 'hook' });
      }
      continue;
    }

    if (file.artifactType === 'types') {
      const stateDecls = stateNodes.map(n => ({
        name: (n.props?.name as string) || 'value',
        initial: String(n.props?.initial ?? ''),
      }));
      const code = generateTypesCode(featureName, stateDecls);
      artifacts.push({ path: file.path, content: code, type: 'types' });
      continue;
    }

    if (file.artifactType === 'theme') {
      // Theme nodes are meta — just export the theme object
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

    // Render component/entry/page/template files
    const code = renderFile(file, config);

    if (file.isEntry) {
      entryCode = code;
      // Also add as artifact so CLI can write it to the correct path
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
