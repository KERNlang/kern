import type {
  AccountedEntry,
  IRNode,
  ResolvedKernConfig,
  SourceMapEntry,
  TailwindVersionProfile,
  TranspileResult,
} from '@kernlang/core';
import {
  accountNode,
  applyTailwindTokenRules,
  buildDiagnostics,
  buildTailwindProfile,
  camelKey,
  colorToTw,
  countTokens,
  escapeJsString,
  escapeJsxAttr,
  escapeJsxText,
  getProps,
  getPseudoStyles,
  getStyles,
  serializeIR,
  stylesToTailwind,
} from '@kernlang/core';
import { buildStructuredArtifacts } from './artifact-utils.js';
import type { PlannedFile } from './structure.js';
import { planStructure } from './structure.js';

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
  hasEventHandlers: boolean;
  colors: Record<string, string> | undefined;
  twProfile: TailwindVersionProfile | undefined;
}

/** Wrap text with t() for i18n, or emit raw string when i18n is disabled */
function tText(ctx: CodeBuilder, key: string, value: string): string {
  return ctx.i18nEnabled ? `{t('${escapeJsString(key)}', '${escapeJsString(value)}')}` : escapeJsxText(value);
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
      pseudoClasses.push(
        expanded
          .split(' ')
          .map((c) => `${twState}:${c}`)
          .join(' '),
      );
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
      if (p.code) {
        ctx.logicBlocks.push(String(p.code));
      } else if (node.children) {
        const handlerChild = node.children.find((c) => c.type === 'handler');
        if (handlerChild?.props?.code) ctx.logicBlocks.push(String(handlerChild.props.code));
      }
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
    case 'svg':
      renderSvgNode(node, ctx, indent);
      break;
    case 'form':
      ctx.lines.push(`${indent}<form${twClasses(node, ctx)}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</form>`);
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
    case 'on':
      renderOnHandler(node, ctx);
      return;
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
      renderNode(child, ctx, `${indent}  `);
    }
  }
}

function renderScreen(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const _p = getProps(node);
  const styles = getStyles(node);
  // Auto-detect dark background and add light text
  const bgColor = styles.backgroundColor || '';
  const isDark = isDarkColor(bgColor);
  const textClass = isDark ? 'text-white' : 'text-zinc-900';
  ctx.lines.push(`${indent}<div${twClasses(node, ctx, `space-y-8 ${textClass} min-h-screen`)}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function isDarkColor(hex: string): boolean {
  if (!hex?.startsWith('#')) return false;
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  // Relative luminance
  return r * 0.299 + g * 0.587 + b * 0.114 < 128;
}

function renderSection(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const title = (p.title as string) || '';
  const key = (p.key as string) || camelKey(title);
  const icon = p.icon as string;
  const tooltip = p.tooltip as string;
  const description = p.description as string;

  // Check if this is the root section (has description) → use SettingsSection component
  if (description) {
    ctx.componentImports.add('SettingsSection');
    ctx.lines.push(`${indent}<SettingsSection`);
    if (ctx.i18nEnabled) {
      ctx.lines.push(`${indent}  title={t('${escapeJsString(key)}.title', '${escapeJsString(title)}')}`);
      ctx.lines.push(
        `${indent}  description={t('${escapeJsString(key)}.description', '${escapeJsString(description)}')}`,
      );
    } else {
      ctx.lines.push(`${indent}  title="${escapeJsxAttr(title)}"`);
      ctx.lines.push(`${indent}  description="${escapeJsxAttr(description)}"`);
    }
    ctx.lines.push(`${indent}>`);
    ctx.lines.push(`${indent}  <div className="space-y-8">`);
    renderChildren(node, ctx, `${indent}  `);
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
    ctx.lines.push(
      `${indent}      <Icon name="${icon}" size="sm" className="text-zinc-500 hover:text-orange-500 cursor-help transition-colors" />`,
    );
    ctx.lines.push(
      `${indent}      <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-72 p-3 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl text-xs text-zinc-300">`,
    );
    if (tooltip) {
      ctx.lines.push(
        `${indent}        ${ctx.i18nEnabled ? `{t('${escapeJsString(key)}.tooltip', ${JSON.stringify(tooltip)})}` : escapeJsxText(tooltip)}`,
      );
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
  let extra = 'shadow-sm';
  if (border) {
    const borderClass = colorToTw('border', border, ctx.colors);
    extra = `shadow-sm border ${borderClass}`;
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
  const tag = (p.tag as string) || 'span';
  const TEXT_TAG_MAP: Record<string, string> = {
    p: 'p',
    h1: 'h1',
    h2: 'h2',
    h3: 'h3',
    h4: 'h4',
    h5: 'h5',
    h6: 'h6',
    label: 'label',
    span: 'span',
    pre: 'pre',
    code: 'code',
  };
  const el = TEXT_TAG_MAP[tag] || 'span';

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
  const text = (p.text as string) || '';
  const onClick = p.onClick as string;
  const variant = (p.variant as string) || 'primary';
  const size = (p.size as string) || 'md';
  const iconName = p.icon as string;

  ctx.hasEventHandlers = true; // onClick requires 'use client'
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
    ctx.lines.push(`${indent}<button${twClasses(node, ctx)} onClick={${onClick || '() => {}'}}>`);
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
  const accent = (p.accent as string) || '#007AFF';
  const onDoubleClick = p.onDoubleClick;

  const setter = bindSetter(bind);
  const dblClick = onDoubleClick ? ` onDoubleClick={() => ${setter}(${onDoubleClick})}` : '';

  ctx.hasEventHandlers = true; // onChange requires 'use client'
  ctx.lines.push(`${indent}<input`);
  ctx.lines.push(`${indent}  type="range"`);
  ctx.lines.push(`${indent}  min={${min}}`);
  ctx.lines.push(`${indent}  max={${max}}`);
  ctx.lines.push(`${indent}  step={${step}}`);
  ctx.lines.push(`${indent}  value={${bindVar(bind)}}`);
  ctx.lines.push(`${indent}  onChange={(e) => ${setter}(parseFloat(e.target.value))}`);
  if (dblClick) ctx.lines.push(`${indent} ${dblClick.trim()}`);
  ctx.lines.push(
    `${indent}  className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-[${accent}]"`,
  );
  ctx.lines.push(`${indent}/>`);
}

function renderToggle(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const bind = p.bind as string;
  const _accent = (p.accent as string) || '#ea580c';
  const setter = bindSetter(bind);

  ctx.hasEventHandlers = true; // onChange requires 'use client'
  ctx.lines.push(`${indent}<label className="relative inline-flex items-center cursor-pointer">`);
  ctx.lines.push(`${indent}  <input`);
  ctx.lines.push(`${indent}    type="checkbox"`);
  ctx.lines.push(`${indent}    className="sr-only peer"`);
  ctx.lines.push(`${indent}    checked={${bindVar(bind)}}`);
  ctx.lines.push(`${indent}    onChange={(e) => ${setter}(e.target.checked)}`);
  ctx.lines.push(`${indent}  />`);
  ctx.lines.push(
    `${indent}  <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600" />`,
  );
  ctx.lines.push(`${indent}</label>`);
}

function renderOnHandler(node: IRNode, ctx: CodeBuilder): void {
  const p = getProps(node);
  const event = (p.event || p.name) as string;
  const handlerRef = p.handler as string;
  const key = p.key as string;
  const isAsync = p.async === 'true' || p.async === true;

  // Get handler code from child handler node
  const handlerChild = (node.children || []).find((c) => c.type === 'handler');
  const code = handlerChild ? (getProps(handlerChild).code as string) || '' : '';

  if (handlerRef && !code) {
    // Just a reference: on event=click handler=handleClick — no code to generate
    return;
  }

  ctx.hasEventHandlers = true; // event handlers require 'use client'
  const fnName = handlerRef || `handle${event.charAt(0).toUpperCase() + event.slice(1)}`;
  const asyncKw = isAsync ? 'async ' : '';

  // Event parameter type
  const paramType =
    event === 'submit'
      ? 'e: React.FormEvent'
      : event === 'click'
        ? 'e: React.MouseEvent'
        : event === 'change'
          ? 'e: React.ChangeEvent'
          : event === 'key' || event === 'keydown' || event === 'keyup'
            ? 'e: React.KeyboardEvent'
            : event === 'focus' || event === 'blur'
              ? 'e: React.FocusEvent'
              : event === 'drag' || event === 'drop'
                ? 'e: React.DragEvent'
                : event === 'scroll'
                  ? 'e: React.UIEvent'
                  : event === 'resize'
                    ? '' // window event, no param
                    : `e: React.SyntheticEvent`;

  const keyGuard = key ? `    if (e.key !== '${key}') return;\n` : '';

  // Use useCallback for event handlers
  ctx.imports.add('useCallback');
  let block = `  const ${fnName} = useCallback(${asyncKw}(${paramType}) => {\n`;
  if (keyGuard) block += keyGuard;
  if (code) {
    for (const line of code.split('\n')) {
      block += `    ${line}\n`;
    }
  }
  block += `  }, []);\n`;
  ctx.logicBlocks.push(block);

  // For keyboard events, add useEffect to register global listener
  if (event === 'key' || event === 'keydown' || event === 'keyup') {
    ctx.imports.add('useEffect');
    const domEvent = event === 'key' ? 'keydown' : event;
    let effect = `  useEffect(() => {\n`;
    effect += `    const listener = (e: KeyboardEvent) => ${fnName}(e as unknown as React.KeyboardEvent);\n`;
    effect += `    window.addEventListener('${domEvent}', listener);\n`;
    effect += `    return () => window.removeEventListener('${domEvent}', listener);\n`;
    effect += `  }, [${fnName}]);\n`;
    ctx.logicBlocks.push(effect);
  }

  // For resize events, add useEffect for window listener
  if (event === 'resize') {
    ctx.imports.add('useEffect');
    let effect = `  useEffect(() => {\n`;
    effect += `    window.addEventListener('resize', ${fnName});\n`;
    effect += `    return () => window.removeEventListener('resize', ${fnName});\n`;
    effect += `  }, [${fnName}]);\n`;
    ctx.logicBlocks.push(effect);
  }
}

function renderGrid(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const cols = parseInt(String(p.cols || 1), 10) || 1;
  const gap = parseInt(String(p.gap || 16), 10) || 16;
  ctx.lines.push(`${indent}<div className="grid grid-cols-1 md:grid-cols-${cols} gap-${Math.round(gap / 4)}">`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

const SVG_ICON_INNER: Record<string, string> = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  plus: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  chart:
    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
  heart:
    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  profile: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
};

function renderSvgNode(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const icon = p.icon as string;
  const size = parseInt(String(p.size || 24), 10) || 24;

  if (icon) {
    const inner = SVG_ICON_INNER[icon] || '<circle cx="12" cy="12" r="4"/>';
    ctx.lines.push(
      `${indent}<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"${twClasses(node, ctx)}>${inner}</svg>`,
    );
  } else {
    const viewBox = (p.viewBox as string) || '0 0 24 24';
    const width = parseInt(String(p.width || size), 10) || size;
    const height = parseInt(String(p.height || size), 10) || size;
    const fill = (p.fill as string) || 'none';
    const stroke = (p.stroke as string) || 'currentColor';
    const content = (p.content as string) || '';
    ctx.lines.push(
      `${indent}<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" fill="${fill}" stroke="${stroke}" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"${twClasses(node, ctx)}>${content}</svg>`,
    );
  }
}

function renderConditional(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const condition = (p.if as string) || 'true';
  const jsCondition = irConditionToJs(condition);

  ctx.lines.push(`${indent}{${jsCondition} && (`);
  ctx.lines.push(`${indent}  <>`);
  renderChildren(node, ctx, `${indent}  `);
  ctx.lines.push(`${indent}  </>`);
  ctx.lines.push(`${indent})}`);
}

function renderComponent(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const ref = (p.ref || p.name) as string;
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

  const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
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
  const src = (p.src as string) || '';
  const styles = getStyles(node);
  const w = styles.width || '40';
  const h = styles.height || '40';
  const isAvatar = src === 'avatar' || src.includes('avatar');
  if (isAvatar) {
    // Render avatar as gradient circle placeholder
    ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'flex items-center justify-center text-white font-bold')} style={{ background: 'linear-gradient(135deg, #8B5CF6, #00CEFF)' }}>
${indent}  <svg width="${Math.round(Number(w) * 0.5)}" height="${Math.round(Number(h) * 0.5)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
${indent}</div>`);
  } else {
    ctx.lines.push(
      `${indent}<img src="${src.startsWith('http') ? src : `/${src}.png`}" alt="${escapeJsxText(src)}"${twClasses(node, ctx)} />`,
    );
  }
}

function renderList(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'space-y-2')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderItem(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const hasChildren = node.children && node.children.length > 0;

  if (hasChildren) {
    ctx.lines.push(
      `${indent}<div${twClasses(node, ctx, 'flex items-center justify-between py-3 px-1')} style={{ borderBottom: '1px solid #1E2530' }}>`,
    );
    renderChildren(node, ctx, indent);
    ctx.lines.push(`${indent}</div>`);
  } else {
    // Render item props as content
    const name = p.name as string;
    const time = p.time as string;
    const calories = p.calories as string;
    const category = p.category as string;
    ctx.lines.push(
      `${indent}<div${twClasses(node, ctx, 'flex items-center justify-between py-3 px-1')} style={{ borderBottom: '1px solid #1E2530' }}>`,
    );
    ctx.lines.push(`${indent}  <div className="flex items-center gap-2">`);
    if (name)
      ctx.lines.push(
        `${indent}    <span className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>${escapeJsxText(name)}</span>`,
      );
    if (time)
      ctx.lines.push(
        `${indent}    <span className="text-xs" style={{ color: '#7A7485' }}>${escapeJsxText(time)}</span>`,
      );
    if (category)
      ctx.lines.push(
        `${indent}    <span className="text-xs" style={{ color: '#7A7485' }}>${escapeJsxText(category)}</span>`,
      );
    ctx.lines.push(`${indent}  </div>`);
    if (calories)
      ctx.lines.push(
        `${indent}  <span className="text-sm" style={{ color: '#B8B3C1' }}>${escapeJsxText(calories)} kcal</span>`,
      );
    ctx.lines.push(`${indent}</div>`);
  }
}

function renderTabs(node: IRNode, ctx: CodeBuilder, indent: string): void {
  ctx.lines.push(
    `${indent}<nav${twClasses(node, ctx, 'flex justify-around items-center py-3 mt-auto')} style={{ borderTop: '1px solid #2A3441' }}>`,
  );
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</nav>`);
}

function renderTab(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const label = p.label as string;
  const icon = p.icon as string;
  const _activeClass = '';
  ctx.lines.push(
    `${indent}<button${twClasses(node, ctx, 'flex flex-col items-center gap-1 text-xs')} style={{ color: '#7A7485' }}>`,
  );
  if (icon)
    ctx.lines.push(
      `${indent}  <span dangerouslySetInnerHTML={{ __html: '${iconToSvg(icon).replace(/'/g, "\\'")}' }} />`,
    );
  ctx.lines.push(`${indent}  ${tText(ctx, camelKey(label), label)}`);
  ctx.lines.push(`${indent}</button>`);
}

function iconToSvg(icon: string): string {
  const svgs: Record<string, string> = {
    home: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    plus: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
    chart:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    stats:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    search:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    settings:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>',
    profile:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    heart:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  };
  return (
    svgs[icon] ||
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/></svg>'
  );
}

function renderProgress(node: IRNode, ctx: CodeBuilder, indent: string): void {
  const p = getProps(node);
  const label = p.label || '';
  const current = Number(p.current || 0);
  const target = Number(p.target || 100);
  const color = (p.color as string) || '#007AFF';
  const pct = Math.round((current / target) * 100);

  ctx.lines.push(`${indent}<div className="mb-4">`);
  ctx.lines.push(`${indent}  <div className="flex justify-between text-sm mb-1.5">`);
  ctx.lines.push(
    `${indent}    <span className="font-semibold" style={{ color: '#F8FAFC' }}>${escapeJsxText(String(label))}</span>`,
  );
  ctx.lines.push(
    `${indent}    <span style={{ color: '#B8B3C1' }}>${current}/${target} ${escapeJsxText(String(p.unit || ''))}</span>`,
  );
  ctx.lines.push(`${indent}  </div>`);
  ctx.lines.push(
    `${indent}  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#1A2030' }}>`,
  );
  ctx.lines.push(
    `${indent}    <div className="h-full rounded-full transition-all" style={{ width: '${pct}%', backgroundColor: '${color}' }} />`,
  );
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
    ctx.hasEventHandlers = true; // onChange requires 'use client'
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

  const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  ctx.lines.push(`${indent}<input${tw}${attrStr} />`);
}

// ── Helpers ─────────────────────────────────────────────────────────────

function bindExpr(bind: string, format: string): string {
  // "{v} dB ({presetLabel})" → `${fixStrengthDb.toFixed(1)} dB (${presetLabel})`
  const expr = format.replace(/\{v\}/g, `\${${bind}.toFixed(1)}`).replace(/\{(\w+)\}/g, (_, name) => `\${${name}}`);
  return `\`${expr}\``;
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
    hasEventHandlers: false,
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
  if (hasLogic && ctx.logicBlocks.some((b) => b.includes('useEffect'))) reactImports.push('useEffect');
  if (hasLogic && ctx.logicBlocks.some((b) => b.includes('useCallback'))) reactImports.push('useCallback');
  if (hasLogic && ctx.logicBlocks.some((b) => b.includes('useMemo'))) reactImports.push('useMemo');
  if (hasLogic && ctx.logicBlocks.some((b) => b.includes('useRef'))) reactImports.push('useRef');
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
    const uiImports = [...ctx.componentImports].filter((c) => ['Icon', 'Button'].includes(c));
    const featureImports = [...ctx.componentImports].filter((c) => !['Icon', 'Button'].includes(c));

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
    const init =
      s.initial === 'true'
        ? 'true'
        : s.initial === 'false'
          ? 'false'
          : Number.isNaN(Number(s.initial))
            ? `'${s.initial}'`
            : s.initial;
    // Check if initial is an expression
    const stateNode = root.children?.find((c) => c.type === 'state' && c.props?.name === s.name);
    const initProp = stateNode?.props?.initial;
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

  const accounted = new Map<IRNode, AccountedEntry>();
  accountNode(accounted, root, 'expressed', undefined, true);
  const CONSUMED = new Set(['state', 'logic', 'on', 'theme', 'handler']);
  for (const child of root.children || []) {
    if (CONSUMED.has(child.type)) accountNode(accounted, child, 'consumed', `${child.type} pre-pass`, true);
  }

  return {
    code: output,
    sourceMap: ctx.sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    diagnostics: buildDiagnostics(root, accounted, 'tailwind'),
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
    hasEventHandlers: false,
    colors: config.colors,
    twProfile: config.frameworkVersions ? buildTailwindProfile(config.frameworkVersions) : undefined,
  };

  const rootNode = file.rootNode;
  renderNode(rootNode, ctx, '    ');

  const name = file.componentName || (rootNode.props?.name as string) || 'Component';
  const hasState = ctx.stateDecls.length > 0;
  const hasLogic = ctx.logicBlocks.length > 0;

  const code: string[] = [];

  // For non-entry files with state/logic/event handlers, add 'use client'
  const needsClient = hasState || hasLogic || ctx.hasEventHandlers;
  if (needsClient) {
    code.push(`'use client';`);
    code.push('');
  }

  // React imports
  const reactImports: string[] = [];
  if (hasState) reactImports.push('useState');
  if (hasLogic && ctx.logicBlocks.some((b) => b.includes('useEffect'))) reactImports.push('useEffect');
  if (hasLogic && ctx.logicBlocks.some((b) => b.includes('useCallback'))) reactImports.push('useCallback');
  if (hasLogic && ctx.logicBlocks.some((b) => b.includes('useMemo'))) reactImports.push('useMemo');
  if (hasLogic && ctx.logicBlocks.some((b) => b.includes('useRef'))) reactImports.push('useRef');
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
    const uiImports = [...ctx.componentImports].filter((c) => ['Icon', 'Button'].includes(c));
    const featureImports = [...ctx.componentImports].filter((c) => !['Icon', 'Button'].includes(c));
    if (uiImports.length > 0) {
      code.push(`import { ${uiImports.join(', ')} } from '${uiLibrary}';`);
    }
    for (const imp of featureImports) {
      code.push(`import { ${imp} } from './${imp}';`);
    }
  }

  code.push('');

  if (file.isEntry) {
    code.push(`export default function ${name}() {`);
  } else {
    code.push(`export function ${name}() {`);
  }

  if (i18nEnabled) {
    code.push(`  const { t } = ${i18nHook}();`);
  }

  // State declarations (only if not extracted to hooks)
  for (const s of ctx.stateDecls) {
    const setter = `set${s.name.charAt(0).toUpperCase() + s.name.slice(1)}`;
    const init =
      s.initial === 'true'
        ? 'true'
        : s.initial === 'false'
          ? 'false'
          : Number.isNaN(Number(s.initial))
            ? `'${s.initial}'`
            : s.initial;
    // Check if initial is an expression
    const stateNode = rootNode.children?.find((c) => c.type === 'state' && c.props?.name === s.name);
    const initProp = stateNode?.props?.initial;
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

  const accounted = new Map<IRNode, AccountedEntry>();
  accountNode(accounted, root, 'expressed', undefined, true);
  const CONSUMED = new Set(['state', 'logic', 'on', 'theme', 'handler']);
  for (const child of root.children || []) {
    if (CONSUMED.has(child.type)) accountNode(accounted, child, 'consumed', `${child.type} pre-pass`, true);
  }

  return {
    code: entryCode,
    sourceMap: [],
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    artifacts,
    diagnostics: buildDiagnostics(root, accounted, 'tailwind'),
  };
}
