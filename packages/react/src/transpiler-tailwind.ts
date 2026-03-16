import type { IRNode, TranspileResult, SourceMapEntry, ResolvedKernConfig, GeneratedArtifact, TailwindVersionProfile } from '@kern/core';
import { stylesToTailwind, colorToTw, countTokens, serializeIR, camelKey, escapeJsxText, escapeJsxAttr, escapeJsString, buildTailwindProfile, applyTailwindTokenRules } from '@kern/core';
import { planStructure } from './structure.js';
import type { PlannedFile } from './structure.js';
import { buildStructuredArtifacts } from './artifact-utils.js';

// ── Code generation ─────────────────────────────────────────────────────

interface StateDecl {
  name: string;
  initial: string;
}

interface CodeBuilder {
  lines: string[];
  sourceMap: SourceMapEntry[];
  imports: Set<string>;
  hooks: Map<string, string>;
  componentImports: Set<string>;
  storeHooks: Set<string>;
  stateDecls: StateDecl[];
  logicBlocks: string[];
  i18nEnabled: boolean;
  colors: Record<string, string> | undefined;
  twProfile: TailwindVersionProfile | undefined;
}

/** Wrap text with t() for i18n, or emit raw string when i18n is disabled */
function tText(ctx: CodeBuilder, key: string, value: string): string {
  return ctx.i18nEnabled ? `{t('${escapeJsString(key)}', '${escapeJsString(value)}')}` : escapeJsxText(value);
}

function getProps(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function getStyles(node: IRNode): Record<string, string> {
  return (getProps(node).styles as Record<string, string>) || {};
}

function getThemeRefs(node: IRNode): string[] {
  return (getProps(node).themeRefs as string[]) || [];
}

function getPseudoStyles(node: IRNode): Record<string, Record<string, string>> {
  return (getProps(node).pseudoStyles as Record<string, Record<string, string>>) || {};
}

function twClasses(node: IRNode, ctx: CodeBuilder, extra: string = ''): string {
  const styles = getStyles(node);
  const pseudo = getPseudoStyles(node);
  let tw = stylesToTailwind(styles, ctx.colors);
  if (ctx.twProfile) tw = applyTailwindTokenRules(tw, ctx.twProfile);

  // Generate pseudo-class Tailwind variants: hover:bg-red-500, active:scale-95
  const pseudoClasses: string[] = [];
  for (const [state, stateStyles] of Object.entries(pseudo)) {
    const twState = state === 'press' ? 'active' : state; // :press → active:
    let expanded = stylesToTailwind(stateStyles, ctx.colors);
    if (ctx.twProfile) expanded = applyTailwindTokenRules(expanded, ctx.twProfile);
    if (expanded) {
      pseudoClasses.push(expanded.split(' ').map(c => `${twState}:${c}`).join(' '));
    }
  }

  const parts = [tw, ...pseudoClasses, extra].filter(Boolean);
  return parts.length > 0 ? ` className="${parts.join(' ')}"` : '';
}

function renderNode(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const irLine = node.loc?.line || 0;
  ctx.sourceMap.push({ irLine, irCol: node.loc?.col || 1, outLine: ctx.lines.length + 1, outCol: 1 });

  switch (node.type) {
    case 'state':
      // Collect state declarations — rendered as useState in component header
      ctx.stateDecls.push({ name: p.name as string, initial: p.initial as string });
      return;
    case 'logic':
      // Collect logic blocks — rendered before return statement
      ctx.logicBlocks.push(p.code as string);
      return;
    case 'screen':
      renderScreen(node, ctx, indent);
      break;
    case 'section':
      renderSection(node, ctx, indent);
      break;
    case 'card':
      renderCard(node, ctx, indent);
      break;
    case 'row':
      renderRow(node, ctx, indent);
      break;
    case 'col':
      renderCol(node, ctx, indent);
      break;
    case 'text':
      renderText(node, ctx, indent);
      break;
    case 'divider':
      renderDivider(node, ctx, indent);
      break;
    case 'button':
      renderButton(node, ctx, indent);
      break;
    case 'slider':
      renderSlider(node, ctx, indent);
      break;
    case 'toggle':
      renderToggle(node, ctx, indent);
      break;
    case 'grid':
      renderGrid(node, ctx, indent);
      break;
    case 'conditional':
      renderConditional(node, ctx, indent);
      break;
    case 'component':
      renderComponent(node, ctx, indent);
      break;
    case 'icon':
      renderIcon(node, ctx, indent);
      break;
    case 'image':
      renderImage(node, ctx, indent);
      break;
    case 'list':
      renderList(node, ctx, indent);
      break;
    case 'item':
      renderItem(node, ctx, indent);
      break;
    case 'tabs':
      renderTabs(node, ctx, indent);
      break;
    case 'tab':
      renderTab(node, ctx, indent);
      break;
    case 'progress':
      renderProgress(node, ctx, indent);
      break;
    case 'input':
      renderInput(node, ctx, indent);
      break;
    case 'theme':
      break; // theme definitions are meta, not rendered
    default:
      // Generic div fallback
      ctx.lines.push(`${indent}<div${twClasses(node, ctx)}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</div>`);
  }
}

function renderChildren(node: IRNode, ctx: CodeBuilder, indent: string): void {
  if (node.children) {
    for (const child of node.children) {
      renderNode(child, ctx, indent + '  ');
    }
  }
}

function renderScreen(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'space-y-8')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderSection(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const title = p.title as string || '';
  const key = p.key as string || camelKey(title);
  const icon = p.icon as string;
  const tooltip = p.tooltip as string;
  const description = p.description as string;

  // Check if this is the root section (has description) → use SettingsSection component
  if (description) {
    ctx.componentImports.add('SettingsSection');
    ctx.lines.push(`${indent}<SettingsSection`);
    if (ctx.i18nEnabled) {
      ctx.lines.push(`${indent}  title={t('${escapeJsString(key)}.title', '${escapeJsString(title)}')}`);
      ctx.lines.push(`${indent}  description={t('${escapeJsString(key)}.description', '${escapeJsString(description)}')}`);
    } else {
      ctx.lines.push(`${indent}  title="${escapeJsxAttr(title)}"`);
      ctx.lines.push(`${indent}  description="${escapeJsxAttr(description)}"`);
    }
    ctx.lines.push(`${indent}>`);
    ctx.lines.push(`${indent}  <div className="space-y-8">`);
    renderChildren(node, ctx, indent + '  ');
    ctx.lines.push(`${indent}  </div>`);
    ctx.lines.push(`${indent}</SettingsSection>`);
    return;
  }

  ctx.lines.push(`${indent}<div>`);
  if (icon) {
    ctx.lines.push(`${indent}  <div className="flex items-center gap-2 mb-4">`);
    ctx.lines.push(`${indent}    <h3 className="text-sm font-medium text-white">`);
    ctx.lines.push(`${indent}      ${tText(ctx, `${key}.title`, title)}`);
    ctx.lines.push(`${indent}    </h3>`);
    ctx.componentImports.add('Icon');
    ctx.lines.push(`${indent}    <div className="relative group">`);
    ctx.lines.push(`${indent}      <Icon name="${icon}" size="sm" className="text-zinc-500 hover:text-orange-500 cursor-help transition-colors" />`);
    ctx.lines.push(`${indent}      <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-72 p-3 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl text-xs text-zinc-300">`);
    if (tooltip) {
      ctx.lines.push(`${indent}        ${ctx.i18nEnabled ? `{t('${escapeJsString(key)}.tooltip', ${JSON.stringify(tooltip)})}` : escapeJsxText(tooltip)}`);
    }
    ctx.lines.push(`${indent}      </div>`);
    ctx.lines.push(`${indent}    </div>`);
    ctx.lines.push(`${indent}  </div>`);
  } else {
    ctx.lines.push(`${indent}  <h3 className="text-sm font-medium text-white mb-4">`);
    ctx.lines.push(`${indent}    ${tText(ctx, `${key}.title`, title)}`);
    ctx.lines.push(`${indent}  </h3>`);
  }

  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderCard(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const styles = { ...getStyles(node) };
  const border = styles.border;
  delete styles.border;
  let extra = '';
  if (border) {
    const borderClass = colorToTw('border', border, ctx.colors);
    extra = `border ${borderClass}`;
  }
  // Use a shallow-copied styles object to avoid mutating the live IR node
  if (node.props) {
    const origStyles = node.props.styles;
    node.props.styles = styles;
    ctx.lines.push(`${indent}<div${twClasses(node, ctx, extra)}>`);
    renderChildren(node, ctx, indent);
    ctx.lines.push(`${indent}</div>`);
    node.props.styles = origStyles;
  } else {
    ctx.lines.push(`${indent}<div${twClasses(node, ctx, extra)}>`);
    renderChildren(node, ctx, indent);
    ctx.lines.push(`${indent}</div>`);
  }
}

function renderRow(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'flex')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderCol(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'flex flex-col')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function isExpr(v: unknown): v is { __expr: true; code: string } {
  return typeof v === 'object' && v !== null && '__expr' in v;
}

function renderText(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const rawValue = p.value;
  const bind = p.bind as string;
  const format = p.format as string;
  const key = p.key as string;
  const tag = p.tag as string || 'span';
  const el = tag === 'p' ? 'p' : tag === 'h1' ? 'h1' : tag === 'h2' ? 'h2' : tag === 'h3' ? 'h3' : tag === 'label' ? 'label' : 'span';

  const tw = twClasses(node, ctx);

  if (isExpr(rawValue)) {
    ctx.lines.push(`${indent}<${el}${tw}>{${rawValue.code}}</${el}>`);
  } else if (bind) {
    if (format) {
      ctx.lines.push(`${indent}<${el}${tw}>{${bindExpr(bind, format)}}</${el}>`);
    } else {
      ctx.lines.push(`${indent}<${el}${tw}>{${bindVar(bind)}}</${el}>`);
    }
  } else if (rawValue) {
    const value = rawValue as string;
    const i18nKey = key || camelKey(value);
    ctx.lines.push(`${indent}<${el}${tw}>${tText(ctx, i18nKey, value)}</${el}>`);
  }
}

function renderDivider(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'h-px')} />`);
}

function renderButton(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const text = p.text as string || '';
  const onClick = p.onClick as string;
  const variant = p.variant as string || 'primary';
  const size = p.size as string || 'md';
  const iconName = p.icon as string;

  if (variant !== 'primary') {
    ctx.componentImports.add('Button');
    ctx.lines.push(`${indent}<Button variant="${variant}" size="${size}" onClick={${onClick}}>`);
    if (iconName) {
      ctx.componentImports.add('Icon');
      ctx.lines.push(`${indent}  <Icon name="${iconName}" size="sm" className="mr-2" />`);
    }
    ctx.lines.push(`${indent}  ${tText(ctx, camelKey(text), text)}`);
    ctx.lines.push(`${indent}</Button>`);
  } else {
    ctx.lines.push(`${indent}<button${twClasses(node, ctx)} onClick={${onClick || '() => {}'}}>`)
    ctx.lines.push(`${indent}  ${tText(ctx, camelKey(text), text)}`);
    ctx.lines.push(`${indent}</button>`);
  }
}

function renderSlider(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const min = p.min || 0;
  const max = p.max || 100;
  const step = p.step || 1;
  const bind = p.bind as string;
  const accent = p.accent as string || '#007AFF';
  const onDoubleClick = p.onDoubleClick;

  const setter = bindSetter(bind);
  const dblClick = onDoubleClick ? ` onDoubleClick={() => ${setter}(${onDoubleClick})}` : '';

  ctx.lines.push(`${indent}<input`);
  ctx.lines.push(`${indent}  type="range"`);
  ctx.lines.push(`${indent}  min={${min}}`);
  ctx.lines.push(`${indent}  max={${max}}`);
  ctx.lines.push(`${indent}  step={${step}}`);
  ctx.lines.push(`${indent}  value={${bindVar(bind)}}`);
  ctx.lines.push(`${indent}  onChange={(e) => ${setter}(parseFloat(e.target.value))}`);
  if (dblClick) ctx.lines.push(`${indent} ${dblClick.trim()}`);
  ctx.lines.push(`${indent}  className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-[${accent}]"`);
  ctx.lines.push(`${indent}/>`);
}

function renderToggle(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const bind = p.bind as string;
  const accent = p.accent as string || '#ea580c';
  const setter = bindSetter(bind);

  ctx.lines.push(`${indent}<label className="relative inline-flex items-center cursor-pointer">`);
  ctx.lines.push(`${indent}  <input`);
  ctx.lines.push(`${indent}    type="checkbox"`);
  ctx.lines.push(`${indent}    className="sr-only peer"`);
  ctx.lines.push(`${indent}    checked={${bindVar(bind)}}`);
  ctx.lines.push(`${indent}    onChange={(e) => ${setter}(e.target.checked)}`);
  ctx.lines.push(`${indent}  />`);
  ctx.lines.push(`${indent}  <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600" />`);
  ctx.lines.push(`${indent}</label>`);
}

function renderGrid(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const cols = p.cols || 1;
  const gap = p.gap || 16;
  ctx.lines.push(`${indent}<div className="grid grid-cols-1 md:grid-cols-${cols} gap-${Math.round(Number(gap) / 4)}">`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderConditional(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const condition = p.if as string || 'true';
  const jsCondition = irConditionToJs(condition);

  ctx.lines.push(`${indent}{${jsCondition} && (`);
  ctx.lines.push(`${indent}  <>`);
  renderChildren(node, ctx, indent + '  ');
  ctx.lines.push(`${indent}  </>`);
  ctx.lines.push(`${indent})}`);
}

function renderComponent(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const ref = p.ref as string;
  if (!ref) return;

  ctx.componentImports.add(ref);

  const hasExplicitOnChange = 'onChange' in p;
  const attrs: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (k === 'ref' || k === 'styles' || k === 'pseudoStyles' || k === 'themeRefs') continue;
    if (k === 'bind') {
      const varName = bindVar(v as string);
      attrs.push(`value={${varName}}`);
      // Only add auto-generated onChange if no explicit one exists
      if (!hasExplicitOnChange) {
        attrs.push(`onChange={${bindSetter(v as string)}}`);
      }
    } else if (k === 'onChange') {
      attrs.push(`onChange={${v}}`);
    } else if (k === 'props') {
      // Multiple props passed through
      const propNames = (v as string).split(',');
      for (const pn of propNames) {
        attrs.push(`${pn.trim()}={${pn.trim()}}`);
      }
    } else if (k === 'disabled') {
      attrs.push(`disabled={${irConditionToJs(v as string)}}`);
    } else if (k === 'default') {
      attrs.push(`defaultValue={${JSON.stringify(v)}}`);
    } else {
      attrs.push(`${k}={${JSON.stringify(v)}}`);
    }
  }

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  ctx.lines.push(`${indent}<${ref}${attrStr} />`);
}

function renderIcon(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const name = p.name as string;
  ctx.componentImports.add('Icon');
  ctx.lines.push(`${indent}<Icon name="${name}" size="sm"${twClasses(node, ctx)} />`);
}

function renderImage(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  ctx.lines.push(`${indent}<img src="/${p.src}.png" alt="${p.src}"${twClasses(node, ctx)} />`);
}

function renderList(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'space-y-2')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderItem(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const tw = twClasses(node, ctx, 'flex items-center justify-between p-3 border-b border-zinc-800');
  const hasChildren = node.children && node.children.length > 0;

  if (hasChildren) {
    ctx.lines.push(`${indent}<div${tw}>`);
    renderChildren(node, ctx, indent);
    ctx.lines.push(`${indent}</div>`);
  } else {
    // Render item props as content
    const name = p.name as string;
    const time = p.time as string;
    const calories = p.calories as string;
    const category = p.category as string;
    ctx.lines.push(`${indent}<div${tw}>`);
    ctx.lines.push(`${indent}  <div>`);
    if (name) ctx.lines.push(`${indent}    <span className="text-sm text-white font-medium">${escapeJsxText(name)}</span>`);
    if (time) ctx.lines.push(`${indent}    <span className="text-xs text-zinc-500 ml-2">${escapeJsxText(time)}</span>`);
    if (category) ctx.lines.push(`${indent}    <span className="text-xs text-zinc-500 ml-2">${escapeJsxText(category)}</span>`);
    ctx.lines.push(`${indent}  </div>`);
    if (calories) ctx.lines.push(`${indent}  <span className="text-sm text-zinc-400">${escapeJsxText(calories)} kcal</span>`);
    ctx.lines.push(`${indent}</div>`);
  }
}

function renderTabs(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<nav${twClasses(node, ctx, 'flex')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</nav>`);
}

function renderTab(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  ctx.lines.push(`${indent}<button${twClasses(node, ctx)}>${tText(ctx, camelKey(p.label as string), p.label as string)}</button>`);
}

function renderProgress(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const label = p.label || '';
  const current = Number(p.current || 0);
  const target = Number(p.target || 100);
  const color = (p.color as string) || '#007AFF';
  const pct = Math.round((current / target) * 100);

  ctx.lines.push(`${indent}<div className="mb-3">`);
  ctx.lines.push(`${indent}  <div className="flex justify-between text-sm mb-1">`);
  ctx.lines.push(`${indent}    <span className="text-zinc-300">${escapeJsxText(String(label))}</span>`);
  ctx.lines.push(`${indent}    <span className="text-zinc-400">${current}/${target} ${escapeJsxText(String(p.unit || ''))}</span>`);
  ctx.lines.push(`${indent}  </div>`);
  ctx.lines.push(`${indent}  <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">`);
  ctx.lines.push(`${indent}    <div className="h-full rounded-full bg-[${color}]" style={{ width: '${pct}%' }} />`);
  ctx.lines.push(`${indent}  </div>`);
  ctx.lines.push(`${indent}</div>`);
}

function renderInput(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const attrs: string[] = [];
  const tw = twClasses(node, ctx);

  if (p.bind) {
    const bind = p.bind as string;
    const setter = bindSetter(bind);
    attrs.push(`value={${bindVar(bind)}}`);
    // Check if onChange is an expression
    if (isExpr(p.onChange)) {
      attrs.push(`onChange={${(p.onChange as { code: string }).code}}`);
    } else if (p.onChange) {
      attrs.push(`onChange={${p.onChange}}`);
    } else {
      attrs.push(`onChange={(e) => ${setter}(e.target.value)}`);
    }
  }
  if (p.placeholder) attrs.push(`placeholder="${p.placeholder}"`);
  if (p.type) attrs.push(`type="${p.type}"`);

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  ctx.lines.push(`${indent}<input${tw}${attrStr} />`);
}

// ── Helpers ─────────────────────────────────────────────────────────────

function bindExpr(bind: string, format: string): string {
  // "{v} dB ({presetLabel})" → `${fixStrengthDb.toFixed(1)} dB (${presetLabel})`
  const expr = format
    .replace(/\{v\}/g, `\${${bind}.toFixed(1)}`)
    .replace(/\{(\w+)\}/g, (_, name) => `\${${name}}`);
  return '`' + expr + '`';
}

function bindVar(bind: string): string {
  // "fixStrengthDb" → fixStrengthDb
  // "settings.audioOutputDeviceId" → settings.audioOutputDeviceId
  return bind;
}

function bindSetter(bind: string): string {
  // "fixStrengthDb" → setFixStrengthDb
  // "normalizeReference" → setNormalizeReference
  if (bind.includes('.')) {
    const parts = bind.split('.');
    return `set${parts[parts.length - 1].charAt(0).toUpperCase() + parts[parts.length - 1].slice(1)}`;
  }
  return `set${bind.charAt(0).toUpperCase() + bind.slice(1)}`;
}

function irConditionToJs(cond: unknown): string {
  // Handle expression objects from {{ }}
  if (typeof cond === 'object' && cond !== null && '__expr' in cond) {
    return (cond as unknown as { code: string }).code;
  }
  // "isPro" → isPro
  // "!isPro" → !isPro
  // "isPro&perStemMode=manual" → isPro && perStemMode === 'manual'
  return String(cond)
    .replace(/&/g, ' && ')
    .replace(/([a-zA-Z_]+)=([a-zA-Z_]+)/g, "$1 === '$2'");
}

// ── Main export ─────────────────────────────────────────────────────────

export function transpileTailwind(root: IRNode, config?: ResolvedKernConfig): TranspileResult {
  // Structured output path
  if (config && config.structure !== 'flat') {
    const plan = planStructure(root, config);
    if (plan) {
      return _transpileTailwindStructured(root, config, plan);
    }
  }
  // Flat output path (default — unchanged)
  return _transpileTailwindInner(root, config);
}

function _transpileTailwindInner(root: IRNode, config?: ResolvedKernConfig): TranspileResult {
  const i18nEnabled = config?.i18n?.enabled ?? true;

  const ctx: CodeBuilder = {
    lines: [],
    sourceMap: [],
    imports: new Set(),
    hooks: new Map(),
    componentImports: new Set(),
    storeHooks: new Set(),
    stateDecls: [],
    logicBlocks: [],
    i18nEnabled,
    colors: config?.colors,
    twProfile: config?.frameworkVersions ? buildTailwindProfile(config.frameworkVersions) : undefined,
  };

  // Render JSX tree (state/logic nodes are collected, not rendered)
  renderNode(root, ctx, '    ');

  const name = (root.props?.name as string) || 'Component';
  const hasState = ctx.stateDecls.length > 0;
  const hasLogic = ctx.logicBlocks.length > 0;

  // Build output
  const code: string[] = [];
  code.push(`'use client';`);
  code.push('');

  // React imports
  const reactImports: string[] = [];
  if (hasState) reactImports.push('useState');
  if (hasLogic && ctx.logicBlocks.some(b => b.includes('useEffect'))) reactImports.push('useEffect');
  if (hasLogic && ctx.logicBlocks.some(b => b.includes('useCallback'))) reactImports.push('useCallback');
  if (hasLogic && ctx.logicBlocks.some(b => b.includes('useMemo'))) reactImports.push('useMemo');
  if (hasLogic && ctx.logicBlocks.some(b => b.includes('useRef'))) reactImports.push('useRef');
  if (reactImports.length > 0) {
    code.push(`import React, { ${reactImports.join(', ')} } from 'react';`);
  }

  const i18nHook = config?.i18n?.hookName ?? 'useTranslation';
  const i18nImport = config?.i18n?.importPath ?? 'react-i18next';
  const uiLibrary = config?.components?.uiLibrary ?? '@components/ui';

  if (i18nEnabled) {
    code.push(`import { ${i18nHook} } from '${i18nImport}';`);
  }

  if (ctx.componentImports.size > 0) {
    const uiImports = [...ctx.componentImports].filter(c => ['Icon', 'Button'].includes(c));
    const featureImports = [...ctx.componentImports].filter(c => !['Icon', 'Button'].includes(c));

    if (uiImports.length > 0) {
      code.push(`import { ${uiImports.join(', ')} } from '${uiLibrary}';`);
    }
    for (const imp of featureImports) {
      code.push(`import { ${imp} } from './${imp}';`);
    }
  }

  code.push('');
  code.push(`export function ${name}() {`);
  if (i18nEnabled) {
    code.push(`  const { t } = ${i18nHook}();`);
  }

  // Generate useState declarations
  for (const s of ctx.stateDecls) {
    const setter = `set${s.name.charAt(0).toUpperCase() + s.name.slice(1)}`;
    const init = s.initial === 'true' ? 'true' : s.initial === 'false' ? 'false' : isNaN(Number(s.initial)) ? `'${s.initial}'` : s.initial;
    // Check if initial is an expression
    const initProp = (root.children?.find(c => c.type === 'state' && c.props?.name === s.name)?.props?.initial);
    const isExpr = typeof initProp === 'object' && initProp !== null && '__expr' in (initProp as object);
    const initVal = isExpr ? (initProp as { code: string }).code : init;
    code.push(`  const [${s.name}, ${setter}] = useState(${initVal});`);
  }

  // Generate logic blocks
  for (const block of ctx.logicBlocks) {
    code.push('');
    for (const line of block.split('\n')) {
      code.push(`  ${line}`);
    }
  }

  code.push('');
  code.push('  return (');
  code.push(...ctx.lines);
  code.push('  );');
  code.push('}');

  const output = code.join('\n');

  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(output);
  const tokenReduction = tsTokenCount > 0 ? Math.round((1 - irTokenCount / tsTokenCount) * 100) : 0;

  return {
    code: output,
    sourceMap: ctx.sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
  };
}

// ── Structured output ────────────────────────────────────────────────────

function _renderTailwindFile(file: PlannedFile, config: ResolvedKernConfig): string {
  const i18nEnabled = config.i18n?.enabled ?? true;
  const ctx: CodeBuilder = {
    lines: [],
    sourceMap: [],
    imports: new Set(),
    hooks: new Map(),
    componentImports: new Set(),
    storeHooks: new Set(),
    stateDecls: [],
    logicBlocks: [],
    i18nEnabled,
    colors: config.colors,
    twProfile: config.frameworkVersions ? buildTailwindProfile(config.frameworkVersions) : undefined,
  };

  const rootNode = file.rootNode;
  renderNode(rootNode, ctx, '    ');

  const name = file.componentName
    || (rootNode.props?.name as string)
    || 'Component';
  const hasState = ctx.stateDecls.length > 0;
  const hasLogic = ctx.logicBlocks.length > 0;

  const code: string[] = [];

  // For non-entry files with state/logic, add 'use client'
  const needsClient = hasState || hasLogic;
  if (needsClient) {
    code.push(`'use client';`);
    code.push('');
  }

  // React imports
  const reactImports: string[] = [];
  if (hasState) reactImports.push('useState');
  if (hasLogic && ctx.logicBlocks.some(b => b.includes('useEffect'))) reactImports.push('useEffect');
  if (hasLogic && ctx.logicBlocks.some(b => b.includes('useCallback'))) reactImports.push('useCallback');
  if (hasLogic && ctx.logicBlocks.some(b => b.includes('useMemo'))) reactImports.push('useMemo');
  if (hasLogic && ctx.logicBlocks.some(b => b.includes('useRef'))) reactImports.push('useRef');
  if (reactImports.length > 0) {
    code.push(`import React, { ${reactImports.join(', ')} } from 'react';`);
  }

  const i18nHook = config.i18n?.hookName ?? 'useTranslation';
  const i18nImport = config.i18n?.importPath ?? 'react-i18next';
  const uiLibrary = config.components?.uiLibrary ?? '@components/ui';

  if (i18nEnabled) {
    code.push(`import { ${i18nHook} } from '${i18nImport}';`);
  }

  if (ctx.componentImports.size > 0) {
    const uiImports = [...ctx.componentImports].filter(c => ['Icon', 'Button'].includes(c));
    const featureImports = [...ctx.componentImports].filter(c => !['Icon', 'Button'].includes(c));
    if (uiImports.length > 0) {
      code.push(`import { ${uiImports.join(', ')} } from '${uiLibrary}';`);
    }
    for (const imp of featureImports) {
      code.push(`import { ${imp} } from './${imp}';`);
    }
  }

  code.push('');

  if (file.isEntry) {
    code.push(`export function ${name}() {`);
  } else {
    code.push(`export function ${name}() {`);
  }

  if (i18nEnabled) {
    code.push(`  const { t } = ${i18nHook}();`);
  }

  // State declarations (only if not extracted to hooks)
  for (const s of ctx.stateDecls) {
    const setter = `set${s.name.charAt(0).toUpperCase() + s.name.slice(1)}`;
    const init = s.initial === 'true' ? 'true' : s.initial === 'false' ? 'false' : isNaN(Number(s.initial)) ? `'${s.initial}'` : s.initial;
    // Check if initial is an expression
    const initProp = (rootNode.children?.find(c => c.type === 'state' && c.props?.name === s.name)?.props?.initial);
    const isExprInit = typeof initProp === 'object' && initProp !== null && '__expr' in (initProp as object);
    const initVal = isExprInit ? (initProp as { code: string }).code : init;
    code.push(`  const [${s.name}, ${setter}] = useState(${initVal});`);
  }

  for (const block of ctx.logicBlocks) {
    code.push('');
    for (const line of block.split('\n')) {
      code.push(`  ${line}`);
    }
  }

  code.push('');
  code.push('  return (');
  code.push(...ctx.lines);
  code.push('  );');
  code.push('}');

  return code.join('\n');
}

function _transpileTailwindStructured(
  root: IRNode,
  config: ResolvedKernConfig,
  plan: import('./structure.js').StructurePlan,
): TranspileResult {
  const { entryCode, artifacts } = buildStructuredArtifacts(
    plan,
    (file, cfg) => _renderTailwindFile(file, cfg),
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
  };
}

