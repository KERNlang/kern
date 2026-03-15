import type { IRNode, TranspileResult, SourceMapEntry } from './types.js';
import { STYLE_SHORTHANDS, VALUE_SHORTHANDS } from './spec.js';

// ── Style-to-Tailwind mapping ───────────────────────────────────────────

function stylesToTailwind(styles: Record<string, string>): string {
  const classes: string[] = [];

  for (const [key, val] of Object.entries(styles)) {
    const expanded = STYLE_SHORTHANDS[key] || key;
    const v = VALUE_SHORTHANDS[val] || val;

    switch (expanded) {
      case 'padding': classes.push(pxToTw('p', v)); break;
      case 'paddingTop': classes.push(pxToTw('pt', v)); break;
      case 'paddingBottom': classes.push(pxToTw('pb', v)); break;
      case 'paddingLeft': classes.push(pxToTw('pl', v)); break;
      case 'paddingRight': classes.push(pxToTw('pr', v)); break;
      case 'margin': classes.push(pxToTw('m', v)); break;
      case 'marginTop': classes.push(pxToTw('mt', v)); break;
      case 'marginBottom': classes.push(pxToTw('mb', v)); break;
      case 'marginLeft': classes.push(pxToTw('ml', v)); break;
      case 'marginRight': classes.push(pxToTw('mr', v)); break;
      case 'backgroundColor': classes.push(colorToTw('bg', v)); break;
      case 'color': classes.push(colorToTw('text', v)); break;
      case 'fontSize': classes.push(fsTw(v)); break;
      case 'fontWeight': classes.push(fwTw(v)); break;
      case 'borderRadius': classes.push(pxToTw('rounded', v)); break;
      case 'width': v === '100%' ? classes.push('w-full') : classes.push(`w-[${addPx(v)}]`); break;
      case 'height': v === '100%' ? classes.push('h-full') : classes.push(`h-[${addPx(v)}]`); break;
      case 'justifyContent':
        if (v === 'space-between') classes.push('justify-between');
        else if (v === 'space-around') classes.push('justify-around');
        else if (v === 'center') classes.push('justify-center');
        else if (v === 'flex-end') classes.push('justify-end');
        else classes.push('justify-start');
        break;
      case 'alignItems':
        if (v === 'center') classes.push('items-center');
        else if (v === 'flex-start') classes.push('items-start');
        else if (v === 'flex-end') classes.push('items-end');
        else if (v === 'stretch') classes.push('items-stretch');
        break;
      case 'flexDirection':
        if (v === 'row') classes.push('flex-row');
        break;
      case 'flex': classes.push(`flex-${v}`); break;
      case 'gap': classes.push(pxToTw('gap', v)); break;
      case 'borderColor': classes.push(colorToTw('border', v)); break;
      case 'borderWidth': classes.push('border'); break;
      case 'overflow': classes.push(`overflow-${v}`); break;
      default:
        // Pass through as arbitrary Tailwind
        classes.push(`[${cssKebab(expanded)}:${addPx(v)}]`);
    }
  }

  return classes.join(' ');
}

function pxToTw(prefix: string, v: string): string {
  const n = Number(v);
  if (isNaN(n)) return `${prefix}-[${v}]`;
  // Tailwind spacing scale: 1=4px, 2=8px, 3=12px, 4=16px, 5=20px, 6=24px, 8=32px
  const twMap: Record<number, string> = {
    0: '0', 1: 'px', 2: '0.5', 4: '1', 6: '1.5', 8: '2', 10: '2.5',
    12: '3', 14: '3.5', 16: '4', 20: '5', 24: '6', 28: '7', 32: '8',
    36: '9', 40: '10', 44: '11', 48: '12',
  };
  return twMap[n] !== undefined ? `${prefix}-${twMap[n]}` : `${prefix}-[${n}px]`;
}

function colorToTw(prefix: string, v: string): string {
  // Map known zinc/orange theme colors to Tailwind classes
  const twColors: Record<string, string> = {
    '#18181b': `${prefix}-zinc-900`, '#27272a': `${prefix}-zinc-800`,
    '#3f3f46': `${prefix}-zinc-700`, '#52525b': `${prefix}-zinc-600`,
    '#71717a': `${prefix}-zinc-500`, '#a1a1aa': `${prefix}-zinc-400`,
    '#d4d4d8': `${prefix}-zinc-300`, '#e4e4e7': `${prefix}-zinc-200`,
    '#f4f4f5': `${prefix}-zinc-100`, '#fafafa': `${prefix}-zinc-50`,
    '#09090b': `${prefix}-zinc-950`, '#ffffff': `${prefix}-white`,
    '#fff': `${prefix}-white`, '#FFF': `${prefix}-white`,
    '#f97316': `${prefix}-orange-500`, '#ea580c': `${prefix}-orange-600`,
    '#F8F9FA': `${prefix}-gray-50`,
  };
  return twColors[v] || `${prefix}-[${v}]`;
}

function fsTw(v: string): string {
  const map: Record<string, string> = {
    '10': 'text-[10px]', '11': 'text-[11px]', '12': 'text-xs', '13': 'text-[13px]',
    '14': 'text-sm', '16': 'text-base', '18': 'text-lg', '20': 'text-xl',
    '24': 'text-2xl', '28': 'text-[28px]', '30': 'text-3xl',
  };
  return map[v] || `text-[${v}px]`;
}

function fwTw(v: string): string {
  const map: Record<string, string> = {
    '300': 'font-light', '400': 'font-normal', '500': 'font-medium',
    '600': 'font-semibold', '700': 'font-bold', '800': 'font-extrabold',
    '900': 'font-black', 'bold': 'font-bold', 'normal': 'font-normal',
    'medium': 'font-medium', 'semibold': 'font-semibold',
  };
  return map[v] || `font-[${v}]`;
}

function addPx(v: string): string {
  const n = Number(v);
  return isNaN(n) ? v : `${n}px`;
}

function cssKebab(s: string): string {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}

// ── Code generation ─────────────────────────────────────────────────────

function countTokens(text: string): number {
  return text.split(/[\s{}()\[\];,.<>:='"]+/).filter(Boolean).length;
}

interface CodeBuilder {
  lines: string[];
  sourceMap: SourceMapEntry[];
  imports: Set<string>;
  hooks: Map<string, string>; // hookName -> initialValue
  componentImports: Set<string>;
  storeHooks: Set<string>;
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

function twClasses(node: IRNode, extra: string = ''): string {
  const styles = getStyles(node);
  const tw = stylesToTailwind(styles);
  const parts = [tw, extra].filter(Boolean);
  return parts.length > 0 ? ` className="${parts.join(' ')}"` : '';
}

function renderNode(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const irLine = node.loc?.line || 0;
  ctx.sourceMap.push({ irLine, irCol: node.loc?.col || 1, outLine: ctx.lines.length + 1, outCol: 1 });

  switch (node.type) {
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
      ctx.lines.push(`${indent}<div${twClasses(node)}>`);
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
  ctx.lines.push(`${indent}<div${twClasses(node, 'space-y-8')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderSection(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const title = p.title as string || '';
  const icon = p.icon as string;

  ctx.lines.push(`${indent}<div>`);
  if (icon) {
    ctx.lines.push(`${indent}  <div className="flex items-center gap-2 mb-4">`);
    ctx.lines.push(`${indent}    <h3 className="text-sm font-medium text-white">`);
    ctx.lines.push(`${indent}      {t('${camelKey(title)}.title', '${title}')}`);
    ctx.lines.push(`${indent}    </h3>`);
    ctx.componentImports.add('Icon');
    ctx.lines.push(`${indent}    <div className="relative group">`);
    ctx.lines.push(`${indent}      <Icon name="${icon}" size="sm" className="text-zinc-500 hover:text-orange-500 cursor-help transition-colors" />`);
    ctx.lines.push(`${indent}      <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-72 p-3 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl text-xs text-zinc-300">`);
    ctx.lines.push(`${indent}        {/* tooltip content */}`);
    ctx.lines.push(`${indent}      </div>`);
    ctx.lines.push(`${indent}    </div>`);
    ctx.lines.push(`${indent}  </div>`);
  } else {
    ctx.lines.push(`${indent}  <h3 className="text-sm font-medium text-white mb-4">`);
    ctx.lines.push(`${indent}    {t('${camelKey(title)}.title', '${title}')}`);
    ctx.lines.push(`${indent}  </h3>`);
  }

  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderCard(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const styles = getStyles(node);
  const border = styles.border;
  delete styles.border;
  let extra = '';
  if (border) extra = `border border-[${border}]`;
  ctx.lines.push(`${indent}<div${twClasses(node, extra)}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderRow(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node, 'flex')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderCol(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node, 'flex flex-col')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderText(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const value = p.value as string;
  const bind = p.bind as string;
  const format = p.format as string;

  const tw = twClasses(node);

  if (bind) {
    if (format) {
      ctx.lines.push(`${indent}<span${tw}>{${bindExpr(bind, format)}}</span>`);
    } else {
      ctx.lines.push(`${indent}<span${tw}>{${bindVar(bind)}}</span>`);
    }
  } else if (value) {
    ctx.lines.push(`${indent}<span${tw}>{t('${camelKey(value)}', '${escapeJsx(value)}')}</span>`);
  }
}

function renderDivider(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node, 'h-px')} />`);
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
    ctx.lines.push(`${indent}  {t('${camelKey(text)}', '${escapeJsx(text)}')}`);
    ctx.lines.push(`${indent}</Button>`);
  } else {
    ctx.lines.push(`${indent}<button${twClasses(node)} onClick={${onClick || '() => {}'}}>`)
    ctx.lines.push(`${indent}  {t('${camelKey(text)}', '${escapeJsx(text)}')}`);
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

  const attrs: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (k === 'ref' || k === 'styles' || k === 'pseudoStyles' || k === 'themeRefs') continue;
    if (k === 'bind') {
      const varName = bindVar(v as string);
      attrs.push(`value={${varName}}`);
      attrs.push(`onChange={${bindSetter(v as string)}}`);
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
  ctx.lines.push(`${indent}<Icon name="${name}" size="sm"${twClasses(node)} />`);
}

function renderImage(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  ctx.lines.push(`${indent}<img src="/${p.src}.png" alt="${p.src}"${twClasses(node)} />`);
}

function renderList(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node, 'space-y-2')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderItem(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node)}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderTabs(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<nav${twClasses(node, 'flex')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</nav>`);
}

function renderTab(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  ctx.lines.push(`${indent}<button${twClasses(node)}>{t('${camelKey(p.label as string)}', '${p.label}')}</button>`);
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
  ctx.lines.push(`${indent}    <span className="text-zinc-300">${label}</span>`);
  ctx.lines.push(`${indent}    <span className="text-zinc-400">${current}/${target} ${p.unit || ''}</span>`);
  ctx.lines.push(`${indent}  </div>`);
  ctx.lines.push(`${indent}  <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">`);
  ctx.lines.push(`${indent}    <div className="h-full rounded-full bg-[${color}]" style={{ width: '${pct}%' }} />`);
  ctx.lines.push(`${indent}  </div>`);
  ctx.lines.push(`${indent}</div>`);
}

function renderInput(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  ctx.lines.push(`${indent}<input${twClasses(node)} />`);
}

// ── Helpers ─────────────────────────────────────────────────────────────

function camelKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
}

function escapeJsx(s: string): string {
  return s.replace(/'/g, "\\'");
}

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

function irConditionToJs(cond: string): string {
  // "isPro" → isPro
  // "!isPro" → !isPro
  // "isPro&perStemMode=manual" → isPro && perStemMode === 'manual'
  return cond
    .replace(/&/g, ' && ')
    .replace(/([a-zA-Z_]+)=([a-zA-Z_]+)/g, "$1 === '$2'");
}

// ── Main export ─────────────────────────────────────────────────────────

export function transpileTailwind(root: IRNode): TranspileResult {
  const ctx: CodeBuilder = {
    lines: [],
    sourceMap: [],
    imports: new Set(),
    hooks: new Map(),
    componentImports: new Set(),
    storeHooks: new Set(),
  };

  // Render JSX tree
  renderNode(root, ctx, '    ');

  const name = (root.props?.name as string) || 'Component';

  // Build output
  const code: string[] = [];
  code.push(`'use client';`);
  code.push('');
  code.push(`import { useTranslation } from 'react-i18next';`);

  if (ctx.componentImports.size > 0) {
    const uiImports = [...ctx.componentImports].filter(c => ['Icon', 'Button'].includes(c));
    const featureImports = [...ctx.componentImports].filter(c => !['Icon', 'Button'].includes(c));

    if (uiImports.length > 0) {
      code.push(`import { ${uiImports.join(', ')} } from '@components/ui';`);
    }
    for (const imp of featureImports) {
      code.push(`import { ${imp} } from './${imp}';`);
    }
  }

  code.push('');
  code.push(`export function ${name}() {`);
  code.push(`  const { t } = useTranslation();`);
  code.push('');
  code.push('  return (');
  code.push(...ctx.lines);
  code.push('  );');
  code.push('}');

  const output = code.join('\n');

  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(output);
  const tokenReduction = Math.round((1 - irTokenCount / tsTokenCount) * 100);

  return {
    code: output,
    sourceMap: ctx.sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
  };
}

function serializeIR(node: IRNode, indent = ''): string {
  let line = `${indent}${node.type}`;
  const props = node.props || {};
  for (const [k, v] of Object.entries(props)) {
    if (k === 'styles' || k === 'pseudoStyles' || k === 'themeRefs') continue;
    line += ` ${k}=${typeof v === 'string' && v.includes(' ') ? `"${v}"` : v}`;
  }
  if (props.styles) {
    const pairs = Object.entries(props.styles as Record<string, string>)
      .map(([k, v]) => `${k}:${v}`).join(',');
    line += ` {${pairs}}`;
  }
  let result = line + '\n';
  if (node.children) {
    for (const child of node.children) {
      result += serializeIR(child, indent + '  ');
    }
  }
  return result;
}
