/**
 * KERN Structure Planner for Vue
 *
 * Adapts React's structure planner for Vue conventions:
 * - .vue files instead of .tsx
 * - composables/ instead of hooks/
 * - ref() / computed() instead of useState / useMemo
 * - Barrel exports use .ts (plain TS, not SFC)
 *
 * Supports: bulletproof, atomic, kern, flat patterns.
 */

import type { IRNode, GeneratedArtifact, ResolvedKernConfig } from '@kernlang/core';

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

export interface ExtractedComposable {
  composableName: string;
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
const ELEMENT_TYPES = new Set(['text', 'button', 'input', 'textarea', 'progress', 'separator', 'divider', 'image', 'icon', 'svg', 'link', 'slider', 'toggle', 'tab', 'item', 'component']);
const GROUND_LAYER_TYPES = new Set([
  'derive', 'transform', 'action', 'guard', 'assume', 'invariant',
  'each', 'collect', 'branch', 'resolve', 'expect', 'recover',
  'pattern', 'apply',
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
  return 'element';
}

// ── Component Name Helpers ───────────────────────────────────────────────

function getNodeName(node: IRNode): string {
  const name = node.props?.name as string | undefined;
  if (name) return name;
  return node.type.charAt(0).toUpperCase() + node.type.slice(1);
}

function getFeatureName(root: IRNode): string {
  return (root.props?.name as string) || 'Component';
}

function toComponentName(base: string, featureName: string, hasExplicitName: boolean): string {
  if (hasExplicitName) return base;
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
      case 'state': result.stateNodes.push(child); break;
      case 'logic': result.logicNodes.push(child); break;
      case 'block': result.blockNodes.push(child); break;
      case 'theme': result.themeNodes.push(child); break;
      default: result.remainingChildren.push(child); break;
    }
  }

  return result;
}

// ── Composable Extraction ────────────────────────────────────────────────

export function extractComposables(
  featureName: string,
  stateNodes: IRNode[],
  logicNodes: IRNode[],
  composablesDir: string,
): ExtractedComposable[] {
  const composables: ExtractedComposable[] = [];

  if (stateNodes.length > 0) {
    const stateDecls = stateNodes.map(n => ({
      name: (n.props?.name as string) || 'value',
      initial: String(n.props?.initial ?? ''),
    }));

    const returnedValues: string[] = [];
    for (const s of stateDecls) {
      returnedValues.push(s.name);
    }

    composables.push({
      composableName: `use${featureName}State`,
      path: `${composablesDir}/use${featureName}State.ts`,
      stateDecls,
      logicBlocks: [],
      returnedValues,
      importedBy: [],
    });
  }

  if (logicNodes.length > 0) {
    const logicBlocks = logicNodes.map(n => (n.props?.code as string) || '');

    const returnedValues: string[] = [];
    const allCode = logicBlocks.join('\n');
    const fnMatches = allCode.match(/(?:const|function)\s+(\w+)/g);
    if (fnMatches) {
      for (const m of fnMatches) {
        const name = m.replace(/^(?:const|function)\s+/, '');
        returnedValues.push(name);
      }
    }

    composables.push({
      composableName: `use${featureName}Logic`,
      path: `${composablesDir}/use${featureName}Logic.ts`,
      stateDecls: [],
      logicBlocks,
      returnedValues,
      importedBy: [],
    });
  }

  return composables;
}

// ── Generate Composable File Content ─────────────────────────────────────

export function generateStateComposableCode(composable: ExtractedComposable): string {
  const lines: string[] = [];
  lines.push(`import { ref } from 'vue';`);
  lines.push('');
  lines.push(`export function ${composable.composableName}() {`);

  for (const s of composable.stateDecls) {
    const init = s.initial === 'true' ? 'true'
      : s.initial === 'false' ? 'false'
      : s.initial === '' ? "''"
      : isNaN(Number(s.initial)) ? `'${s.initial}'`
      : s.initial;
    lines.push(`  const ${s.name} = ref(${init});`);
  }

  lines.push('');
  lines.push(`  return { ${composable.returnedValues.join(', ')} };`);
  lines.push('}');

  return lines.join('\n');
}

export function generateLogicComposableCode(composable: ExtractedComposable, stateComposableName?: string): string {
  const lines: string[] = [];

  // Detect needed Vue imports
  const allCode = composable.logicBlocks.join('\n');
  const vueImports: string[] = [];
  if (allCode.includes('watch')) vueImports.push('watch');
  if (allCode.includes('computed')) vueImports.push('computed');
  if (allCode.includes('onMounted')) vueImports.push('onMounted');
  if (allCode.includes('ref')) vueImports.push('ref');

  if (vueImports.length > 0) {
    lines.push(`import { ${vueImports.sort().join(', ')} } from 'vue';`);
  }

  if (stateComposableName) {
    lines.push(`import { ${stateComposableName} } from './${stateComposableName}';`);
  }

  if (vueImports.length > 0 || stateComposableName) {
    lines.push('');
  }

  lines.push(`export function ${composable.composableName}() {`);

  if (stateComposableName) {
    lines.push(`  const state = ${stateComposableName}();`);
  }

  for (const block of composable.logicBlocks) {
    for (const line of block.split('\n')) {
      lines.push(`  ${line}`);
    }
    lines.push('');
  }

  if (composable.returnedValues.length > 0) {
    lines.push(`  return { ${composable.returnedValues.join(', ')} };`);
  }

  lines.push('}');

  return lines.join('\n');
}

// ── Generate Types File Content ──────────────────────────────────────────

export function generateTypesCode(featureName: string, stateDecls: { name: string; initial: string }[]): string {
  const lines: string[] = [];
  lines.push(`import type { Ref } from 'vue';`);
  lines.push('');
  lines.push(`export interface ${featureName}State {`);

  for (const s of stateDecls) {
    const tsType = s.initial === 'true' || s.initial === 'false' ? 'boolean'
      : !isNaN(Number(s.initial)) && s.initial !== '' ? 'number'
      : 'string';
    lines.push(`  ${s.name}: Ref<${tsType}>;`);
  }

  lines.push('}');
  return lines.join('\n');
}

// ── Generate Barrel Export Content ────────────────────────────────────────

export function generateBarrelCode(barrel: BarrelExport): string {
  return barrel.exports
    .map(e => `export { ${e.name} } from '${e.from}';`)
    .join('\n');
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
    path: `${featureDir}/index.vue`,
    artifactType: 'entry',
    nodes: [root],
    rootNode: root,
    dependsOn: [],
    isEntry: true,
  });

  // Block components → components/
  for (const block of blockNodes) {
    const rawName = getNodeName(block);
    const hasExplicitName = !!(block.props?.name);
    const compName = deduplicateName(toComponentName(rawName, featureName, hasExplicitName), usedNames);

    files.push({
      path: `${featureDir}/components/${compName}.vue`,
      artifactType: 'component',
      nodes: [block],
      rootNode: block,
      dependsOn: [`${featureDir}/index.vue`],
      isEntry: false,
      componentName: compName,
    });
  }

  // Composables (Vue equivalent of hooks)
  const composables = extractComposables(featureName, stateNodes, logicNodes, `${featureDir}/composables`);
  for (const composable of composables) {
    files.push({
      path: composable.path,
      artifactType: 'hook',
      nodes: composable.stateDecls.length > 0 ? stateNodes : logicNodes,
      rootNode: root,
      dependsOn: [],
      isEntry: false,
    });
  }

  // Types
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

  // Barrel
  const barrels: BarrelExport[] = [{
    path: `${featureDir}/barrel.ts`,
    exports: [{ name: featureName, from: './index' }],
  }];

  // Wire up dependencies
  const entryFile = files[0];
  const componentPaths = files.filter(f => f.artifactType === 'component').map(f => f.path);
  const composablePaths = files.filter(f => f.artifactType === 'hook').map(f => f.path);
  entryFile.dependsOn = [...componentPaths, ...composablePaths];

  return { files, barrels };
}

function planAtomic(root: IRNode): StructurePlan {
  const featureName = getFeatureName(root);
  const { stateNodes, logicNodes, blockNodes, themeNodes, remainingChildren } = collectExtractableNodes(root);
  const usedNames = new Set<string>();
  const files: PlannedFile[] = [];

  // Page → pages/
  files.push({
    path: `pages/${featureName}Page.vue`,
    artifactType: 'page',
    nodes: [root],
    rootNode: root,
    dependsOn: [],
    isEntry: true,
  });

  // Template → templates/
  files.push({
    path: `templates/${featureName}Template.vue`,
    artifactType: 'template',
    nodes: [root],
    rootNode: root,
    dependsOn: [],
    isEntry: false,
  });

  // Blocks → organisms/
  for (const block of blockNodes) {
    const rawName = getNodeName(block);
    const hasExplicitName = !!(block.props?.name);
    const compName = deduplicateName(toComponentName(rawName, featureName, hasExplicitName), usedNames);

    files.push({
      path: `organisms/${compName}.vue`,
      artifactType: 'component',
      nodes: [block],
      rootNode: block,
      dependsOn: [],
      isEntry: false,
      componentName: compName,
    });
  }

  // Containers → molecules, elements → atoms
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
      path: `molecules/${compName}.vue`,
      artifactType: 'component',
      nodes: [mol],
      rootNode: mol,
      dependsOn: [],
      isEntry: false,
      componentName: compName,
    });
  }

  for (const atom of atoms) {
    if (!atom.props?.name) continue;
    const rawName = getNodeName(atom);
    const compName = deduplicateName(rawName, usedNames);
    files.push({
      path: `atoms/${compName}.vue`,
      artifactType: 'component',
      nodes: [atom],
      rootNode: atom,
      dependsOn: [],
      isEntry: false,
      componentName: compName,
    });
  }

  // Composables
  const composables = extractComposables(featureName, stateNodes, logicNodes, 'composables');
  for (const composable of composables) {
    files.push({
      path: composable.path,
      artifactType: 'hook',
      nodes: composable.stateDecls.length > 0 ? stateNodes : logicNodes,
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
    path: `surfaces/${featureName}.surface.vue`,
    artifactType: 'entry',
    nodes: [root],
    rootNode: root,
    dependsOn: [],
    isEntry: true,
  });

  // Blocks
  for (const block of blockNodes) {
    const rawName = getNodeName(block);
    const hasExplicitName = !!(block.props?.name);
    const compName = deduplicateName(toComponentName(rawName, featureName, hasExplicitName), usedNames);

    files.push({
      path: `blocks/${compName}.block.vue`,
      artifactType: 'component',
      nodes: [block],
      rootNode: block,
      dependsOn: [],
      isEntry: false,
      componentName: compName,
    });
  }

  // Signals (composables for state + logic)
  if (stateNodes.length > 0 || logicNodes.length > 0) {
    const composables = extractComposables(featureName, stateNodes, logicNodes, 'signals');
    for (const composable of composables) {
      files.push({
        path: composable.path,
        artifactType: 'hook',
        nodes: composable.stateDecls.length > 0 ? stateNodes : logicNodes,
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

// ── Nuxt Adapter ─────────────────────────────────────────────────────────

export function adaptPlanForNuxt(plan: StructurePlan, root: IRNode): StructurePlan {
  const isLayout = root.type === 'layout';
  const isError = root.type === 'error';

  for (const file of plan.files) {
    if (file.isEntry) {
      if (isLayout) file.path = file.path.replace(/index\.vue$|[^/]+\.surface\.vue$|[^/]+Page\.vue$/, 'layout.vue');
      else if (isError) file.path = file.path.replace(/index\.vue$|[^/]+\.surface\.vue$|[^/]+Page\.vue$/, 'error.vue');
      else {
        if (!file.path.includes('index.vue')) {
          file.path = file.path.replace(/[^/]+\.surface\.vue$|[^/]+Page\.vue$/, 'page.vue');
        }
      }
    }
  }

  return plan;
}

// ── Main Planner ─────────────────────────────────────────────────────────

export function planVueStructure(root: IRNode, config: ResolvedKernConfig): StructurePlan | null {
  const structure = config.structure;

  if (structure === 'flat') return null;

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

  if (config.target === 'nuxt') {
    plan = adaptPlanForNuxt(plan, root);
  }

  return plan;
}
