/**
 * KERN Structure Planner
 *
 * Target-agnostic module that splits an IRNode tree into multiple files
 * based on a structure pattern (bulletproof, atomic, kern, flat).
 *
 * The planner classifies nodes by role, assigns them to files with correct
 * paths per pattern, extracts hooks (state/logic), and resolves imports.
 */

import type { GeneratedArtifact, IRNode, ResolvedKernConfig } from '@kernlang/core';

// ── Types ────────────────────────────────────────────────────────────────

export type NodeRole = 'surface' | 'block' | 'element' | 'container' | 'state' | 'logic' | 'theme' | 'meta';

export interface PlannedFile {
  path: string;
  artifactType: GeneratedArtifact['type'];
  nodes: IRNode[];
  rootNode: IRNode;
  dependsOn: string[];
  isEntry: boolean;
  componentName?: string;
}

export interface StructurePlan {
  files: PlannedFile[];
  barrels: BarrelExport[];
}

export interface BarrelExport {
  path: string;
  exports: { name: string; from: string }[];
}

export interface ExtractedHook {
  hookName: string;
  path: string;
  stateDecls: { name: string; initial: string }[];
  logicBlocks: string[];
  returnedValues: string[];
  importedBy: string[];
}

// ── Node Classification ──────────────────────────────────────────────────

const SURFACE_TYPES = new Set(['screen', 'page', 'modal']);
const BLOCK_TYPES = new Set(['card', 'section', 'form', 'list', 'grid', 'tabs']);
const CONTAINER_TYPES = new Set(['row', 'col']);
const ELEMENT_TYPES = new Set([
  'text',
  'button',
  'input',
  'textarea',
  'progress',
  'separator',
  'divider',
  'image',
  'icon',
  'svg',
  'link',
  'slider',
  'toggle',
  'tab',
  'item',
  'component',
]);
const GROUND_LAYER_TYPES = new Set([
  'derive',
  'transform',
  'action',
  'guard',
  'assume',
  'invariant',
  'each',
  'collect',
  'branch',
  'resolve',
  'expect',
  'recover',
  'pattern',
  'apply',
]);

export function classifyNode(node: IRNode): NodeRole {
  if (node.type === 'state') return 'state';
  if (node.type === 'logic' || node.type === 'handler') return 'logic';
  if (node.type === 'theme') return 'theme';
  if (node.type === 'metadata') return 'meta';
  if (GROUND_LAYER_TYPES.has(node.type)) return 'logic';
  if (SURFACE_TYPES.has(node.type)) return 'surface';
  if (BLOCK_TYPES.has(node.type)) return 'block';
  if (CONTAINER_TYPES.has(node.type)) return 'container';
  if (ELEMENT_TYPES.has(node.type)) return 'element';
  return 'element'; // fallback
}

// ── Component Name Helpers ───────────────────────────────────────────────

function getNodeName(node: IRNode): string {
  const name = node.props?.name as string | undefined;
  if (name) return name;
  // Derive from type: card → Card, section → Section
  return node.type.charAt(0).toUpperCase() + node.type.slice(1);
}

function getFeatureName(root: IRNode): string {
  return (root.props?.name as string) || 'Component';
}

function toComponentName(base: string, featureName: string, hasExplicitName: boolean): string {
  // If the node has an explicit name prop, use it as-is
  if (hasExplicitName) return base;
  // Generic type-derived names get prefixed: Card → DashboardCard
  const generic = ['Card', 'Section', 'Form', 'List', 'Grid', 'Tabs', 'Modal'];
  if (generic.includes(base)) {
    return `${featureName}${base}`;
  }
  return base;
}

function toCamelCase(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

// ── Deduplication ────────────────────────────────────────────────────────

function deduplicateName(name: string, usedNames: Set<string>): string {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }
  let idx = 2;
  while (usedNames.has(`${name}${idx}`)) idx++;
  const deduped = `${name}${idx}`;
  usedNames.add(deduped);
  return deduped;
}

// ── Collect extractable children ─────────────────────────────────────────

interface ExtractableNodes {
  stateNodes: IRNode[];
  logicNodes: IRNode[];
  blockNodes: IRNode[];
  themeNodes: IRNode[];
  remainingChildren: IRNode[];
}

function collectExtractableNodes(root: IRNode): ExtractableNodes {
  const result: ExtractableNodes = {
    stateNodes: [],
    logicNodes: [],
    blockNodes: [],
    themeNodes: [],
    remainingChildren: [],
  };

  for (const child of root.children || []) {
    const role = classifyNode(child);
    switch (role) {
      case 'state':
        result.stateNodes.push(child);
        break;
      case 'logic':
        result.logicNodes.push(child);
        break;
      case 'block':
        result.blockNodes.push(child);
        break;
      case 'theme':
        result.themeNodes.push(child);
        break;
      default:
        result.remainingChildren.push(child);
        break;
    }
  }

  return result;
}

// ── Hook Extraction ──────────────────────────────────────────────────────

export function extractHooks(
  featureName: string,
  stateNodes: IRNode[],
  logicNodes: IRNode[],
  hooksDir: string,
): ExtractedHook[] {
  const hooks: ExtractedHook[] = [];

  if (stateNodes.length > 0) {
    const stateDecls = stateNodes.map((n) => ({
      name: (n.props?.name as string) || 'value',
      initial: String(n.props?.initial ?? ''),
    }));

    const returnedValues: string[] = [];
    for (const s of stateDecls) {
      const setter = `set${s.name.charAt(0).toUpperCase() + s.name.slice(1)}`;
      returnedValues.push(s.name, setter);
    }

    hooks.push({
      hookName: `use${featureName}State`,
      path: `${hooksDir}/use${featureName}State.ts`,
      stateDecls,
      logicBlocks: [],
      returnedValues,
      importedBy: [],
    });
  }

  if (logicNodes.length > 0) {
    const logicBlocks = logicNodes.map((n) => (n.props?.code as string) || '');

    // Determine which state values the logic blocks reference
    const returnedValues: string[] = [];
    const allCode = logicBlocks.join('\n');
    // Extract function/const names that would be returned
    const fnMatches = allCode.match(/(?:const|function)\s+(\w+)/g);
    if (fnMatches) {
      for (const m of fnMatches) {
        const name = m.replace(/^(?:const|function)\s+/, '');
        returnedValues.push(name);
      }
    }

    hooks.push({
      hookName: `use${featureName}Logic`,
      path: `${hooksDir}/use${featureName}Logic.ts`,
      stateDecls: [],
      logicBlocks,
      returnedValues,
      importedBy: [],
    });
  }

  return hooks;
}

// ── Generate Hook File Content ───────────────────────────────────────────

export function generateStateHookCode(hook: ExtractedHook): string {
  const lines: string[] = [];
  lines.push(`import { useState } from 'react';`);
  lines.push('');
  lines.push(`export function ${hook.hookName}() {`);

  for (const s of hook.stateDecls) {
    const setter = `set${s.name.charAt(0).toUpperCase() + s.name.slice(1)}`;
    const init =
      s.initial === 'true'
        ? 'true'
        : s.initial === 'false'
          ? 'false'
          : s.initial === ''
            ? "''"
            : Number.isNaN(Number(s.initial))
              ? `'${s.initial}'`
              : s.initial;
    lines.push(`  const [${s.name}, ${setter}] = useState(${init});`);
  }

  lines.push('');
  lines.push(`  return { ${hook.returnedValues.join(', ')} };`);
  lines.push('}');

  return lines.join('\n');
}

export function generateLogicHookCode(hook: ExtractedHook, stateHookName?: string): string {
  const lines: string[] = [];

  // Detect needed React imports
  const allCode = hook.logicBlocks.join('\n');
  const reactHooks: string[] = [];
  if (allCode.includes('useEffect')) reactHooks.push('useEffect');
  if (allCode.includes('useCallback')) reactHooks.push('useCallback');
  if (allCode.includes('useMemo')) reactHooks.push('useMemo');
  if (allCode.includes('useRef')) reactHooks.push('useRef');

  if (reactHooks.length > 0) {
    lines.push(`import { ${reactHooks.join(', ')} } from 'react';`);
  }

  if (stateHookName) {
    lines.push(`import { ${stateHookName} } from './${stateHookName}';`);
  }

  if (reactHooks.length > 0 || stateHookName) {
    lines.push('');
  }

  lines.push(`export function ${hook.hookName}() {`);

  if (stateHookName) {
    lines.push(`  const state = ${stateHookName}();`);
  }

  for (const block of hook.logicBlocks) {
    for (const line of block.split('\n')) {
      lines.push(`  ${line}`);
    }
    lines.push('');
  }

  if (hook.returnedValues.length > 0) {
    lines.push(`  return { ${hook.returnedValues.join(', ')} };`);
  }

  lines.push('}');

  return lines.join('\n');
}

// ── Generate Types File Content ──────────────────────────────────────────

export function generateTypesCode(featureName: string, stateDecls: { name: string; initial: string }[]): string {
  const lines: string[] = [];
  lines.push(`export interface ${featureName}Props {`);

  for (const s of stateDecls) {
    const setter = `set${s.name.charAt(0).toUpperCase() + s.name.slice(1)}`;
    const tsType =
      s.initial === 'true' || s.initial === 'false'
        ? 'boolean'
        : !Number.isNaN(Number(s.initial)) && s.initial !== ''
          ? 'number'
          : 'string';
    lines.push(`  ${s.name}: ${tsType};`);
    lines.push(`  ${setter}: (value: ${tsType}) => void;`);
  }

  lines.push('}');
  return lines.join('\n');
}

// ── Generate Barrel Export Content ────────────────────────────────────────

export function generateBarrelCode(barrel: BarrelExport): string {
  return barrel.exports.map((e) => `export { ${e.name} } from '${e.from}';`).join('\n');
}

// ── Pattern Planners ─────────────────────────────────────────────────────

function planBulletproof(root: IRNode): StructurePlan {
  const featureName = getFeatureName(root);
  const featureDir = `features/${toCamelCase(featureName)}`;
  const { stateNodes, logicNodes, blockNodes, themeNodes } = collectExtractableNodes(root);
  const usedNames = new Set<string>();
  const files: PlannedFile[] = [];

  // Entry component
  files.push({
    path: `${featureDir}/index.tsx`,
    artifactType: 'entry',
    nodes: [root],
    rootNode: root,
    dependsOn: [],
    isEntry: true,
  });

  // Block components → components/
  for (const block of blockNodes) {
    const rawName = getNodeName(block);
    const hasExplicitName = !!block.props?.name;
    const compName = deduplicateName(toComponentName(rawName, featureName, hasExplicitName), usedNames);

    files.push({
      path: `${featureDir}/components/${compName}.tsx`,
      artifactType: 'component',
      nodes: [block],
      rootNode: block,
      dependsOn: [`${featureDir}/index.tsx`],
      isEntry: false,
      componentName: compName,
    });
  }

  // Hooks
  const hooks = extractHooks(featureName, stateNodes, logicNodes, `${featureDir}/hooks`);
  for (const hook of hooks) {
    files.push({
      path: hook.path,
      artifactType: 'hook',
      nodes: hook.stateDecls.length > 0 ? stateNodes : logicNodes,
      rootNode: root,
      dependsOn: [],
      isEntry: false,
    });
  }

  // Types (if state exists)
  if (stateNodes.length > 0) {
    files.push({
      path: `${featureDir}/types/${toCamelCase(featureName)}.types.ts`,
      artifactType: 'types',
      nodes: stateNodes,
      rootNode: root,
      dependsOn: [],
      isEntry: false,
    });
  }

  // Theme
  if (themeNodes.length > 0) {
    files.push({
      path: `${featureDir}/theme.ts`,
      artifactType: 'theme',
      nodes: themeNodes,
      rootNode: root,
      dependsOn: [],
      isEntry: false,
    });
  }

  // Barrel re-export (separate from entry index.tsx)
  const barrels: BarrelExport[] = [
    {
      path: `${featureDir}/barrel.ts`,
      exports: [{ name: featureName, from: './index' }],
    },
  ];

  // Wire up dependencies
  const entryFile = files[0];
  const componentPaths = files.filter((f) => f.artifactType === 'component').map((f) => f.path);
  const hookPaths = files.filter((f) => f.artifactType === 'hook').map((f) => f.path);
  entryFile.dependsOn = [...componentPaths, ...hookPaths];

  return { files, barrels };
}

function planAtomic(root: IRNode): StructurePlan {
  const featureName = getFeatureName(root);
  const { stateNodes, logicNodes, blockNodes, themeNodes, remainingChildren } = collectExtractableNodes(root);
  const usedNames = new Set<string>();
  const files: PlannedFile[] = [];

  // Page → pages/
  files.push({
    path: `pages/${featureName}Page.tsx`,
    artifactType: 'page',
    nodes: [root],
    rootNode: root,
    dependsOn: [],
    isEntry: true,
  });

  // Template → templates/
  files.push({
    path: `templates/${featureName}Template.tsx`,
    artifactType: 'template',
    nodes: [root],
    rootNode: root,
    dependsOn: [],
    isEntry: false,
  });

  // Blocks → organisms/
  for (const block of blockNodes) {
    const rawName = getNodeName(block);
    const hasExplicitName = !!block.props?.name;
    const compName = deduplicateName(toComponentName(rawName, featureName, hasExplicitName), usedNames);

    files.push({
      path: `organisms/${compName}.tsx`,
      artifactType: 'component',
      nodes: [block],
      rootNode: block,
      dependsOn: [],
      isEntry: false,
      componentName: compName,
    });
  }

  // Containers with children (molecules) and elements (atoms)
  const molecules: IRNode[] = [];
  const atoms: IRNode[] = [];

  for (const child of remainingChildren) {
    const role = classifyNode(child);
    if (role === 'container' && child.children && child.children.length > 0) {
      molecules.push(child);
    } else if (role === 'element') {
      atoms.push(child);
    }
  }

  // Also extract atoms from within blocks
  for (const block of blockNodes) {
    if (block.children) {
      for (const child of block.children) {
        const role = classifyNode(child);
        if (role === 'element' && child.props?.name) {
          atoms.push(child);
        }
      }
    }
  }

  for (const mol of molecules) {
    const rawName = getNodeName(mol);
    const compName = deduplicateName(rawName, usedNames);

    files.push({
      path: `molecules/${compName}.tsx`,
      artifactType: 'component',
      nodes: [mol],
      rootNode: mol,
      dependsOn: [],
      isEntry: false,
      componentName: compName,
    });
  }

  for (const atom of atoms) {
    if (!atom.props?.name) continue; // Only extract named elements
    const rawName = getNodeName(atom);
    const compName = deduplicateName(rawName, usedNames);

    files.push({
      path: `atoms/${compName}.tsx`,
      artifactType: 'component',
      nodes: [atom],
      rootNode: atom,
      dependsOn: [],
      isEntry: false,
      componentName: compName,
    });
  }

  // Hooks
  const hooks = extractHooks(featureName, stateNodes, logicNodes, 'hooks');
  for (const hook of hooks) {
    files.push({
      path: hook.path,
      artifactType: 'hook',
      nodes: hook.stateDecls.length > 0 ? stateNodes : logicNodes,
      rootNode: root,
      dependsOn: [],
      isEntry: false,
    });
  }

  // Types
  if (stateNodes.length > 0) {
    files.push({
      path: `types/${toCamelCase(featureName)}.types.ts`,
      artifactType: 'types',
      nodes: stateNodes,
      rootNode: root,
      dependsOn: [],
      isEntry: false,
    });
  }

  // Theme
  if (themeNodes.length > 0) {
    files.push({
      path: `theme/${toCamelCase(featureName)}.theme.ts`,
      artifactType: 'theme',
      nodes: themeNodes,
      rootNode: root,
      dependsOn: [],
      isEntry: false,
    });
  }

  return { files, barrels: [] };
}

function planKern(root: IRNode): StructurePlan {
  const featureName = getFeatureName(root);
  const { stateNodes, logicNodes, blockNodes, themeNodes } = collectExtractableNodes(root);
  const usedNames = new Set<string>();
  const files: PlannedFile[] = [];

  // Surface
  files.push({
    path: `surfaces/${featureName}.surface.tsx`,
    artifactType: 'entry',
    nodes: [root],
    rootNode: root,
    dependsOn: [],
    isEntry: true,
  });

  // Blocks
  for (const block of blockNodes) {
    const rawName = getNodeName(block);
    const hasExplicitName = !!block.props?.name;
    const compName = deduplicateName(toComponentName(rawName, featureName, hasExplicitName), usedNames);

    files.push({
      path: `blocks/${compName}.block.tsx`,
      artifactType: 'component',
      nodes: [block],
      rootNode: block,
      dependsOn: [],
      isEntry: false,
      componentName: compName,
    });
  }

  // Signals (split state + logic)
  if (stateNodes.length > 0 || logicNodes.length > 0) {
    const hooks = extractHooks(featureName, stateNodes, logicNodes, 'signals');
    for (const hook of hooks) {
      files.push({
        path: hook.path,
        artifactType: 'hook',
        nodes: hook.stateDecls.length > 0 ? stateNodes : logicNodes,
        rootNode: root,
        dependsOn: [],
        isEntry: false,
      });
    }
  }

  // Tokens (theme)
  if (themeNodes.length > 0) {
    files.push({
      path: `tokens/${toCamelCase(featureName)}.tokens.ts`,
      artifactType: 'theme',
      nodes: themeNodes,
      rootNode: root,
      dependsOn: [],
      isEntry: false,
    });
  }

  // Models (types)
  if (stateNodes.length > 0) {
    files.push({
      path: `models/${toCamelCase(featureName)}.model.ts`,
      artifactType: 'types',
      nodes: stateNodes,
      rootNode: root,
      dependsOn: [],
      isEntry: false,
    });
  }

  return { files, barrels: [] };
}

// ── Next.js Adapter ──────────────────────────────────────────────────────

export function adaptPlanForNextjs(plan: StructurePlan, root: IRNode): StructurePlan {
  const isLayout = root.type === 'layout';
  const isLoading = root.type === 'loading';
  const isError = root.type === 'error';

  // Find the entry file and adjust its path for Next.js conventions
  for (const file of plan.files) {
    if (file.isEntry) {
      if (isLayout) file.path = file.path.replace(/index\.tsx$|[^/]+\.surface\.tsx$|[^/]+Page\.tsx$/, 'layout.tsx');
      else if (isLoading)
        file.path = file.path.replace(/index\.tsx$|[^/]+\.surface\.tsx$|[^/]+Page\.tsx$/, 'loading.tsx');
      else if (isError) file.path = file.path.replace(/index\.tsx$|[^/]+\.surface\.tsx$|[^/]+Page\.tsx$/, 'error.tsx');
      else {
        // Default page — for bulletproof, keep index.tsx; for others, page.tsx
        if (!file.path.includes('index.tsx')) {
          file.path = file.path.replace(/[^/]+\.surface\.tsx$|[^/]+Page\.tsx$/, 'page.tsx');
        }
      }
    }
  }

  return plan;
}

// ── Main Planner ─────────────────────────────────────────────────────────

export function planStructure(root: IRNode, config: ResolvedKernConfig): StructurePlan | null {
  const structure = config.structure;

  if (structure === 'flat') return null; // Use existing flat code path

  let plan: StructurePlan;
  switch (structure) {
    case 'bulletproof':
      plan = planBulletproof(root);
      break;
    case 'atomic':
      plan = planAtomic(root);
      break;
    case 'kern':
      plan = planKern(root);
      break;
    default:
      return null;
  }

  // Apply Next.js adaptations if target is nextjs
  if (config.target === 'nextjs') {
    plan = adaptPlanForNextjs(plan, root);
  }

  return plan;
}
