import type { IRNode, TranspileResult, SourceMapEntry, ResolvedKernConfig, GeneratedArtifact, AccountedEntry } from '@kernlang/core';
import { expandStyles, countTokens, serializeIR, cssPropertyName, buildDiagnostics, accountNode } from '@kernlang/core';
import { planStructure } from './structure.js';
import type { PlannedFile } from './structure.js';
import { buildStructuredArtifacts } from './artifact-utils.js';

const NODE_TO_ELEMENT: Record<string, string> = {
  screen: 'div',
  row: 'div',
  col: 'div',
  card: 'div',
  scroll: 'div',
  text: 'span',
  image: 'img',
  progress: 'div',
  divider: 'hr',
  button: 'button',
  input: 'input',
  modal: 'dialog',
  list: 'ul',
  item: 'li',
  tabs: 'nav',
  tab: 'button',
  header: 'header',
};


function cssValue(key: string, value: string | number): string {
  if (typeof value === 'number') {
    const unitless = ['flex', 'fontWeight', 'opacity', 'zIndex', 'lineHeight'];
    if (unitless.some(u => key.toLowerCase().includes(u.toLowerCase()))) return String(value);
    return `${value}px`;
  }
  return String(value);
}

export function transpileWeb(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  // Structured output path
  if (_config && _config.structure !== 'flat') {
    const plan = planStructure(root, _config);
    if (plan) {
      return _transpileWebStructured(root, _config, plan);
    }
  }
  // Flat output path (default — unchanged)
  return _transpileWebFlat(root, _config);
}

function _transpileWebFlat(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  const sourceMap: SourceMapEntry[] = [];
  const cssClasses: Record<string, Record<string, string | number>> = {};
  let classIdx = 0;
  const jsxLines: string[] = [];

  // Collect themes
  const themes: Record<string, Record<string, string>> = {};
  function collectThemes(node: IRNode): void {
    if (node.type === 'theme' && node.props) {
      const props = node.props as Record<string, unknown>;
      if (props.styles) {
        const name = (props.name as string) || `theme_${classIdx++}`;
        themes[name] = props.styles as Record<string, string>;
      }
    }
    if (node.children) node.children.forEach(collectThemes);
  }
  collectThemes(root);

  function getClassName(nodeType: string): string {
    return `${nodeType}_${classIdx++}`;
  }

  function renderNode(node: IRNode, indent: string): void {
    if (node.type === 'theme') return;

    const el = NODE_TO_ELEMENT[node.type] || 'div';
    const irLine = node.loc?.line || 0;
    const outLine = jsxLines.length + 1;
    sourceMap.push({ irLine, irCol: node.loc?.col || 1, outLine, outCol: 1 });

    const props = node.props || {};
    const attrs: string[] = [];

    // Merge styles: theme refs + inline
    let mergedStyles: Record<string, string | number> = {};
    const themeRefs = (props.themeRefs as string[]) || [];
    for (const ref of themeRefs) {
      if (themes[ref]) {
        mergedStyles = { ...mergedStyles, ...expandStyles(themes[ref]) };
      }
    }
    if (props.styles) {
      mergedStyles = { ...mergedStyles, ...expandStyles(props.styles as Record<string, string>) };
    }

    // Add layout defaults
    if (node.type === 'screen') {
      if (!mergedStyles.display) mergedStyles.display = 'flex';
      if (!mergedStyles.flexDirection) mergedStyles.flexDirection = 'column';
      if (!mergedStyles.minHeight) mergedStyles.minHeight = '100vh';
    }
    if (node.type === 'row') {
      if (!mergedStyles.display) mergedStyles.display = 'flex';
      if (!mergedStyles.flexDirection) mergedStyles.flexDirection = 'row';
    }
    if (node.type === 'col') {
      if (!mergedStyles.display) mergedStyles.display = 'flex';
      if (!mergedStyles.flexDirection) mergedStyles.flexDirection = 'column';
    }
    if (node.type === 'card') {
      if (!mergedStyles.boxShadow) mergedStyles.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
    }

    let className = '';
    if (Object.keys(mergedStyles).length > 0) {
      className = getClassName(node.type);
      cssClasses[className] = mergedStyles;
      attrs.push(`className={styles.${className}}`);
    }

    // Pseudo-styles as CSS hover/active
    const pseudoStyles = props.pseudoStyles as Record<string, Record<string, string>> | undefined;

    // Props as attributes
    for (const [k, v] of Object.entries(props)) {
      if (['styles', 'pseudoStyles', 'themeRefs', 'value', 'text', 'src'].includes(k)) continue;
      if (k === 'to' && node.type === 'button') {
        attrs.push(`onClick={() => router.push('/${v}')}`);
        continue;
      }
      attrs.push(`${k === 'active' ? 'data-active' : k}="${v}"`);
    }

    // Image src
    if (node.type === 'image' && props.src) {
      attrs.push(`src="/${props.src}.png"`);
      attrs.push(`alt="${props.src}"`);
    }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    const hasChildren = (node.children && node.children.length > 0) ||
      (node.type === 'text' && props.value) ||
      (node.type === 'button' && props.text) ||
      (node.type === 'progress');

    if (hasChildren) {
      jsxLines.push(`${indent}<${el}${attrStr}>`);

      if (node.type === 'text' && props.value) {
        jsxLines.push(`${indent}  {${JSON.stringify(props.value)}}`);
      }

      if (node.type === 'button' && props.text) {
        jsxLines.push(`${indent}  ${props.text}`);
      }

      if (node.type === 'progress') {
        const label = props.label || '';
        const current = Number(props.current || 0);
        const target = Number(props.target || 100);
        const unit = props.unit || '';
        const color = (props.color as string) || '#007AFF';
        const pct = Math.round((current / target) * 100);
        const barClass = getClassName('progressBar');
        const fillClass = getClassName('progressFill');
        cssClasses[barClass] = { height: 8, borderRadius: 4, backgroundColor: '#E0E0E0', overflow: 'hidden', width: '100%' };
        cssClasses[fillClass] = { height: 8, borderRadius: 4, backgroundColor: color, width: `${pct}%` };

        jsxLines.push(`${indent}  <span className={styles.progressLabel}>${label}: ${current}/${target} ${unit}</span>`);
        jsxLines.push(`${indent}  <div className={styles.${barClass}}>`);
        jsxLines.push(`${indent}    <div className={styles.${fillClass}} />`);
        jsxLines.push(`${indent}  </div>`);
      }

      if (node.children) {
        for (const child of node.children) {
          renderNode(child, indent + '  ');
        }
      }

      jsxLines.push(`${indent}</${el}>`);
    } else if (node.type === 'image') {
      jsxLines.push(`${indent}<${el}${attrStr} />`);
    } else if (node.type === 'divider') {
      jsxLines.push(`${indent}<${el}${attrStr} />`);
    } else if (node.type === 'input') {
      jsxLines.push(`${indent}<${el}${attrStr} />`);
    } else {
      jsxLines.push(`${indent}<${el}${attrStr} />`);
    }
  }

  renderNode(root, '    ');

  const name = (root.props?.name as string) || 'Component';
  const code: string[] = [];

  // React + Next.js compatible
  code.push(`'use client';`);
  code.push('');
  code.push(`import React from 'react';`);
  code.push('');

  // CSS Module styles
  code.push(`const styles: Record<string, React.CSSProperties> = {`);
  for (const [cname, cval] of Object.entries(cssClasses)) {
    const entries = Object.entries(cval)
      .map(([k, v]) => `    ${k}: ${typeof v === 'number' ? v : `'${v}'`}`)
      .join(',\n');
    code.push(`  ${cname}: {`);
    code.push(entries + ',');
    code.push(`  },`);
  }
  if (!cssClasses['progressLabel']) {
    code.push(`  progressLabel: {`);
    code.push(`    fontSize: 14,`);
    code.push(`    marginBottom: 4,`);
    code.push(`  },`);
  }
  code.push(`};`);
  code.push('');
  code.push(`export default function ${name}() {`);
  code.push('  return (');
  code.push(...jsxLines);
  code.push('  );');
  code.push('}');

  const output = code.join('\n');

  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(output);
  const tokenReduction = tsTokenCount > 0 ? Math.round((1 - irTokenCount / tsTokenCount) * 100) : 0;

  const accounted = new Map<IRNode, AccountedEntry>();
  accountNode(accounted, root, 'expressed', undefined, true);
  const CONSUMED = new Set(['state', 'logic', 'on', 'theme', 'handler']);
  for (const child of root.children || []) {
    if (CONSUMED.has(child.type)) accountNode(accounted, child, 'consumed', child.type + ' pre-pass', true);
  }

  return {
    code: output,
    sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    diagnostics: buildDiagnostics(root, accounted, 'web'),
  };
}

// ── Structured output ────────────────────────────────────────────────────

function _renderWebFile(file: PlannedFile, _config: ResolvedKernConfig): string {
  const rootNode = file.rootNode;
  const name = file.componentName || (rootNode.props?.name as string) || 'Component';

  const sourceMap: SourceMapEntry[] = [];
  const cssClasses: Record<string, Record<string, string | number>> = {};
  let classIdx = 0;
  const jsxLines: string[] = [];

  const themes: Record<string, Record<string, string>> = {};
  function collectThemes(node: IRNode): void {
    if (node.type === 'theme' && node.props?.styles) {
      const themeName = (node.props.name as string) || `theme_${classIdx++}`;
      themes[themeName] = node.props.styles as Record<string, string>;
    }
    if (node.children) node.children.forEach(collectThemes);
  }
  collectThemes(rootNode);

  function getClassName(nodeType: string): string {
    return `${nodeType}_${classIdx++}`;
  }

  function renderNodeInner(node: IRNode, indent: string): void {
    if (node.type === 'theme') return;

    const el = NODE_TO_ELEMENT[node.type] || 'div';
    const props = node.props || {};
    const attrs: string[] = [];

    let mergedStyles: Record<string, string | number> = {};
    const themeRefs = (props.themeRefs as string[]) || [];
    for (const ref of themeRefs) {
      if (themes[ref]) mergedStyles = { ...mergedStyles, ...expandStyles(themes[ref]) };
    }
    if (props.styles) mergedStyles = { ...mergedStyles, ...expandStyles(props.styles as Record<string, string>) };

    if (node.type === 'screen') { if (!mergedStyles.display) mergedStyles.display = 'flex'; if (!mergedStyles.flexDirection) mergedStyles.flexDirection = 'column'; if (!mergedStyles.minHeight) mergedStyles.minHeight = '100vh'; }
    if (node.type === 'row') { if (!mergedStyles.display) mergedStyles.display = 'flex'; if (!mergedStyles.flexDirection) mergedStyles.flexDirection = 'row'; }
    if (node.type === 'col') { if (!mergedStyles.display) mergedStyles.display = 'flex'; if (!mergedStyles.flexDirection) mergedStyles.flexDirection = 'column'; }
    if (node.type === 'card') { if (!mergedStyles.boxShadow) mergedStyles.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'; }

    if (Object.keys(mergedStyles).length > 0) {
      const cn = getClassName(node.type);
      cssClasses[cn] = mergedStyles;
      attrs.push(`className={styles.${cn}}`);
    }

    for (const [k, v] of Object.entries(props)) {
      if (['styles', 'pseudoStyles', 'themeRefs', 'value', 'text', 'src'].includes(k)) continue;
      if (k === 'to' && node.type === 'button') { attrs.push(`onClick={() => router.push('/${v}')}`); continue; }
      attrs.push(`${k === 'active' ? 'data-active' : k}="${v}"`);
    }

    if (node.type === 'image' && props.src) { attrs.push(`src="/${props.src}.png"`); attrs.push(`alt="${props.src}"`); }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    const hasChildren = (node.children && node.children.length > 0) || (node.type === 'text' && props.value) || (node.type === 'button' && props.text);

    if (hasChildren) {
      jsxLines.push(`${indent}<${el}${attrStr}>`);
      if (node.type === 'text' && props.value) jsxLines.push(`${indent}  {${JSON.stringify(props.value)}}`);
      if (node.type === 'button' && props.text) jsxLines.push(`${indent}  ${props.text}`);
      if (node.children) for (const child of node.children) renderNodeInner(child, indent + '  ');
      jsxLines.push(`${indent}</${el}>`);
    } else {
      jsxLines.push(`${indent}<${el}${attrStr} />`);
    }
  }

  renderNodeInner(rootNode, '    ');

  const code: string[] = [];
  code.push(`'use client';`);
  code.push('');
  code.push(`import React from 'react';`);
  code.push('');

  code.push(`const styles: Record<string, React.CSSProperties> = {`);
  for (const [cname, cval] of Object.entries(cssClasses)) {
    const entries = Object.entries(cval).map(([k, v]) => `    ${k}: ${typeof v === 'number' ? v : `'${v}'`}`).join(',\n');
    code.push(`  ${cname}: {`);
    code.push(entries + ',');
    code.push(`  },`);
  }
  code.push(`};`);
  code.push('');
  code.push(`export default function ${name}() {`);
  code.push('  return (');
  code.push(...jsxLines);
  code.push('  );');
  code.push('}');

  return code.join('\n');
}

function _transpileWebStructured(
  root: IRNode,
  config: ResolvedKernConfig,
  plan: import('./structure.js').StructurePlan,
): TranspileResult {
  const { entryCode, artifacts } = buildStructuredArtifacts(
    plan,
    (file, cfg) => _renderWebFile(file, cfg),
    root,
    config,
  );

  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(entryCode);
  const tokenReduction = tsTokenCount > 0 ? Math.round((1 - irTokenCount / tsTokenCount) * 100) : 0;

  return {
    code: entryCode,
    sourceMap: [],
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    artifacts,
    diagnostics: buildDiagnostics(root, (() => { const m = new Map<IRNode, AccountedEntry>(); accountNode(m, root, 'expressed', undefined, true); return m; })(), 'web'),
  };
}

