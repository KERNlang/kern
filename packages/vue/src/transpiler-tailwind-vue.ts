/**
 * Vue 3 Tailwind Transpiler — generates <script setup> + <template> with Tailwind classes
 *
 * Mirrors @kernlang/react/transpiler-tailwind.ts but outputs Vue SFCs with
 * Tailwind utility classes instead of React JSX. No <style scoped> block —
 * all styling is done via Tailwind class attributes.
 */

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
  expandStyles,
  getProps,
  getPseudoStyles,
  getStyles,
  getThemeRefs,
  serializeIR,
  stylesToTailwind,
} from '@kernlang/core';

// ── State Declarations ───────────────────────────────────────────────────

interface StateDecl {
  name: string;
  initial: string;
}

// ── Event Handler Declarations ──────────────────────────────────────────

interface EventHandlerDecl {
  event: string;
  fnName: string;
  code: string;
  isAsync: boolean;
  key?: string;
  paramType: string;
}

// ── Build Context ────────────────────────────────────────────────────────

interface TwVueBuilder {
  templateLines: string[];
  vueImports: Set<string>;
  stateDecls: StateDecl[];
  eventHandlers: EventHandlerDecl[];
  logicBlocks: string[];
  sourceMap: SourceMapEntry[];
  themes: Record<string, Record<string, string>>;
  config: ResolvedKernConfig | undefined;
  i18nEnabled: boolean;
  colors: Record<string, string> | undefined;
  twProfile: TailwindVersionProfile | undefined;
}

function createBuilder(config?: ResolvedKernConfig): TwVueBuilder {
  return {
    templateLines: [],
    vueImports: new Set(),
    stateDecls: [],
    eventHandlers: [],
    logicBlocks: [],
    sourceMap: [],
    themes: {},
    config,
    i18nEnabled: config?.i18n?.enabled ?? false,
    colors: config?.colors,
    twProfile: config?.frameworkVersions ? buildTailwindProfile(config.frameworkVersions) : undefined,
  };
}

// ── Theme Collection ─────────────────────────────────────────────────────

function collectThemes(node: IRNode, ctx: TwVueBuilder): void {
  if (node.type === 'theme' && node.props?.styles) {
    const name = (node.props.name as string) || `theme_${ctx.templateLines.length}`;
    ctx.themes[name] = node.props.styles as Record<string, string>;
  }
  if (node.children) node.children.forEach((c) => collectThemes(c, ctx));
}

// ── Tailwind Class Generation ────────────────────────────────────────────

function twClasses(node: IRNode, ctx: TwVueBuilder, extra: string = ''): string {
  // Merge theme refs + inline styles — cast to string since Tailwind only uses string values
  const merged: Record<string, string> = {};
  for (const ref of getThemeRefs(node)) {
    if (ctx.themes[ref]) {
      const expanded = expandStyles(ctx.themes[ref]);
      for (const [k, v] of Object.entries(expanded)) merged[k] = String(v);
    }
  }
  const styles = getStyles(node);
  if (Object.keys(styles).length > 0) {
    const expanded = expandStyles(styles);
    for (const [k, v] of Object.entries(expanded)) merged[k] = String(v);
  }

  let tw = stylesToTailwind(merged, ctx.colors);
  if (ctx.twProfile) tw = applyTailwindTokenRules(tw, ctx.twProfile);

  // Generate pseudo-class Tailwind variants
  const pseudo = getPseudoStyles(node);
  const pseudoClasses: string[] = [];
  for (const [state, stateStyles] of Object.entries(pseudo)) {
    const twState = state === 'press' ? 'active' : state;
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
  return parts.length > 0 ? ` class="${parts.join(' ')}"` : '';
}

// ── i18n helper ──────────────────────────────────────────────────────────

function tText(ctx: TwVueBuilder, key: string, value: string): string {
  return ctx.i18nEnabled ? `{{ t('${escapeJsString(key)}', '${escapeJsString(value)}') }}` : value;
}

// ── Semantic text elements ───────────────────────────────────────────────

function textElement(variant?: string): string {
  if (!variant) return 'p';
  const map: Record<string, string> = {
    h1: 'h1',
    h2: 'h2',
    h3: 'h3',
    h4: 'h4',
    h5: 'h5',
    h6: 'h6',
    caption: 'small',
    small: 'small',
    code: 'code',
  };
  return map[variant] || 'p';
}

// ── Dark background detection ────────────────────────────────────────────

function isDarkColor(hex: string): boolean {
  if (!hex?.startsWith('#')) return false;
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 < 128;
}

// ── Event Type Mapping ──────────────────────────────────────────────────

function eventParamType(event: string): string {
  if (event === 'click') return 'e: MouseEvent';
  if (event === 'submit') return 'e: Event';
  if (event === 'change') return 'e: Event';
  if (event === 'key' || event === 'keydown' || event === 'keyup') return 'e: KeyboardEvent';
  if (event === 'focus' || event === 'blur') return 'e: FocusEvent';
  if (event === 'drag' || event === 'drop') return 'e: DragEvent';
  if (event === 'scroll') return 'e: Event';
  if (event === 'resize') return '';
  if (event === 'input') return 'e: Event';
  return 'e: Event';
}

function collectOnHandler(node: IRNode, ctx: TwVueBuilder): void {
  const props = getProps(node);
  const event = (props.event || props.name) as string;
  const handlerRef = props.handler as string;
  const key = props.key as string;
  const isAsync = props.async === 'true' || props.async === true;

  const handlerChild = (node.children || []).find((c) => c.type === 'handler');
  const code = handlerChild ? (getProps(handlerChild).code as string) || '' : '';

  if (handlerRef && !code) return;

  const fnName = handlerRef || `handle${event.charAt(0).toUpperCase() + event.slice(1)}`;
  const paramType = eventParamType(event);

  const needsMounted = event === 'key' || event === 'keydown' || event === 'keyup' || event === 'resize';
  if (needsMounted) {
    ctx.vueImports.add('onMounted');
    ctx.vueImports.add('onUnmounted');
  }

  ctx.eventHandlers.push({ event, fnName, code, isAsync, key, paramType });
}

// ── Node rendering ───────────────────────────────────────────────────────

const NON_VISUAL = new Set(['state', 'logic', 'theme', 'handler', 'on']);

function renderNode(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const props = getProps(node);
  const irLine = node.loc?.line || 0;
  ctx.sourceMap.push({ irLine, irCol: node.loc?.col || 1, outLine: ctx.templateLines.length + 1, outCol: 1 });

  switch (node.type) {
    case 'state':
      ctx.vueImports.add('ref');
      ctx.stateDecls.push({ name: props.name as string, initial: props.initial as string });
      return;
    case 'logic':
      ctx.logicBlocks.push(props.code as string);
      return;
    case 'on':
      collectOnHandler(node, ctx);
      return;
    case 'theme':
    case 'handler':
      return;
    default:
      break;
  }

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
    case 'input':
      renderInput(node, ctx, indent);
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
    case 'icon':
      renderIcon(node, ctx, indent);
      break;
    case 'svg':
      renderSvgNode(node, ctx, indent);
      break;
    case 'form':
      ctx.templateLines.push(`${indent}<form${twClasses(node, ctx)}>`);
      renderChildren(node, ctx, indent);
      ctx.templateLines.push(`${indent}</form>`);
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
    default:
      ctx.templateLines.push(`${indent}<div${twClasses(node, ctx)}>`);
      renderChildren(node, ctx, indent);
      ctx.templateLines.push(`${indent}</div>`);
  }
}

function renderChildren(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  if (node.children) {
    for (const child of node.children) {
      renderNode(child, ctx, `${indent}  `);
    }
  }
}

function renderScreen(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  // Check raw styles + theme refs for background color
  let bgColor = '';
  for (const ref of getThemeRefs(node)) {
    if (ctx.themes[ref]?.backgroundColor) bgColor = ctx.themes[ref].backgroundColor;
    if (ctx.themes[ref]?.bg) bgColor = ctx.themes[ref].bg;
  }
  const styles = getStyles(node);
  if (styles.backgroundColor) bgColor = styles.backgroundColor;
  if (styles.bg) bgColor = styles.bg;
  const isDark = isDarkColor(bgColor);
  const textClass = isDark ? 'text-white' : 'text-zinc-900';
  ctx.templateLines.push(`${indent}<div${twClasses(node, ctx, `space-y-8 ${textClass} min-h-screen`)}>`);
  renderChildren(node, ctx, indent);
  ctx.templateLines.push(`${indent}</div>`);
}

function renderSection(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const title = (p.title as string) || '';
  const key = (p.key as string) || camelKey(title);

  ctx.templateLines.push(`${indent}<div>`);
  if (title) {
    ctx.templateLines.push(`${indent}  <h3 class="text-sm font-medium text-white mb-4">`);
    ctx.templateLines.push(`${indent}    ${tText(ctx, `${key}.title`, title)}`);
    ctx.templateLines.push(`${indent}  </h3>`);
  }
  renderChildren(node, ctx, indent);
  ctx.templateLines.push(`${indent}</div>`);
}

function renderCard(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const styles = getStyles(node);
  const border = styles.border;
  let extra = 'shadow-sm';
  if (border) {
    const borderClass = colorToTw('border', border, ctx.colors);
    extra = `shadow-sm border ${borderClass}`;
  }
  // Temporarily remove border from styles for tw conversion
  if (node.props && border) {
    const origStyles = node.props.styles;
    const cleaned = { ...(origStyles as Record<string, unknown>) };
    delete cleaned.border;
    node.props.styles = cleaned;
    ctx.templateLines.push(`${indent}<div${twClasses(node, ctx, extra)}>`);
    renderChildren(node, ctx, indent);
    ctx.templateLines.push(`${indent}</div>`);
    node.props.styles = origStyles;
  } else {
    ctx.templateLines.push(`${indent}<div${twClasses(node, ctx, extra)}>`);
    renderChildren(node, ctx, indent);
    ctx.templateLines.push(`${indent}</div>`);
  }
}

function renderRow(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  ctx.templateLines.push(`${indent}<div${twClasses(node, ctx, 'flex')}>`);
  renderChildren(node, ctx, indent);
  ctx.templateLines.push(`${indent}</div>`);
}

function renderCol(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  ctx.templateLines.push(`${indent}<div${twClasses(node, ctx, 'flex flex-col')}>`);
  renderChildren(node, ctx, indent);
  ctx.templateLines.push(`${indent}</div>`);
}

function renderText(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const rawValue = p.value;
  const variant = p.variant as string | undefined;
  const tag = (p.tag as string) || undefined;
  const el = tag || textElement(variant);
  const tw = twClasses(node, ctx);

  if (!rawValue) return;

  // Expression object: { __expr: true, code: "count" } → {{ count }}
  if (typeof rawValue === 'object' && rawValue !== null && '__expr' in rawValue) {
    ctx.templateLines.push(`${indent}<${el}${tw}>{{ ${(rawValue as unknown as { code: string }).code} }}</${el}>`);
    return;
  }

  const value = rawValue as string;
  if (typeof value !== 'string') return;

  if (value.startsWith('{{') && value.endsWith('}}')) {
    ctx.templateLines.push(`${indent}<${el}${tw}>{{ ${value.slice(2, -2).trim()} }}</${el}>`);
  } else {
    const i18nKey = (p.key as string) || camelKey(value);
    ctx.templateLines.push(`${indent}<${el}${tw}>${tText(ctx, i18nKey, value)}</${el}>`);
  }
}

function renderDivider(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  ctx.templateLines.push(`${indent}<div${twClasses(node, ctx, 'h-px')} />`);
}

function renderButton(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const text = (p.text as string) || '';
  const to = p.to as string;
  const onClick = p.onClick as string;
  const action = p.action as string;

  if (to) {
    ctx.templateLines.push(`${indent}<router-link to="/${to}"${twClasses(node, ctx)}>`);
    ctx.templateLines.push(`${indent}  ${tText(ctx, camelKey(text), text)}`);
    ctx.templateLines.push(`${indent}</router-link>`);
  } else {
    const clickAttr = onClick ? ` @click="${onClick}"` : action ? ` @click="${action}"` : '';
    ctx.templateLines.push(`${indent}<button${twClasses(node, ctx)}${clickAttr}>`);
    ctx.templateLines.push(`${indent}  ${tText(ctx, camelKey(text), text)}`);
    ctx.templateLines.push(`${indent}</button>`);
  }
}

function renderInput(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const attrs: string[] = [];
  const tw = twClasses(node, ctx);

  if (p.bind) attrs.push(`v-model="${p.bind}"`);
  if (p.placeholder) attrs.push(`placeholder="${p.placeholder}"`);
  if (p.type) attrs.push(`type="${p.type}"`);

  const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  ctx.templateLines.push(`${indent}<input${tw}${attrStr} />`);
}

function renderSlider(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const min = p.min || 0;
  const max = p.max || 100;
  const step = p.step || 1;
  const bind = p.bind as string;
  const accent = (p.accent as string) || '#007AFF';

  ctx.templateLines.push(`${indent}<input`);
  ctx.templateLines.push(`${indent}  type="range"`);
  ctx.templateLines.push(`${indent}  :min="${min}"`);
  ctx.templateLines.push(`${indent}  :max="${max}"`);
  ctx.templateLines.push(`${indent}  :step="${step}"`);
  if (bind) ctx.templateLines.push(`${indent}  v-model="${bind}"`);
  ctx.templateLines.push(
    `${indent}  class="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-[${accent}]"`,
  );
  ctx.templateLines.push(`${indent}/>`);
}

function renderToggle(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const bind = p.bind as string;

  ctx.templateLines.push(`${indent}<label class="relative inline-flex items-center cursor-pointer">`);
  ctx.templateLines.push(`${indent}  <input`);
  ctx.templateLines.push(`${indent}    type="checkbox"`);
  ctx.templateLines.push(`${indent}    class="sr-only peer"`);
  if (bind) ctx.templateLines.push(`${indent}    v-model="${bind}"`);
  ctx.templateLines.push(`${indent}  />`);
  ctx.templateLines.push(
    `${indent}  <div class="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600" />`,
  );
  ctx.templateLines.push(`${indent}</label>`);
}

function renderGrid(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const cols = parseInt(String(p.cols || 1), 10) || 1;
  const gap = parseInt(String(p.gap || 16), 10) || 16;
  ctx.templateLines.push(`${indent}<div class="grid grid-cols-1 md:grid-cols-${cols} gap-${Math.round(gap / 4)}">`);
  renderChildren(node, ctx, indent);
  ctx.templateLines.push(`${indent}</div>`);
}

function renderConditional(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const condition = (p.if as string) || 'true';
  ctx.templateLines.push(`${indent}<template v-if="${condition}">`);
  renderChildren(node, ctx, indent);
  ctx.templateLines.push(`${indent}</template>`);
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

function renderIcon(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const name = p.name as string;
  const size = parseInt(String(p.size || 20), 10) || 20;
  const inner = SVG_ICON_INNER[name] || '<circle cx="12" cy="12" r="4"/>';
  ctx.templateLines.push(
    `${indent}<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${twClasses(node, ctx)}>${inner}</svg>`,
  );
}

function renderSvgNode(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const icon = p.icon as string;
  const size = parseInt(String(p.size || 24), 10) || 24;

  if (icon) {
    const inner = SVG_ICON_INNER[icon] || '<circle cx="12" cy="12" r="4"/>';
    ctx.templateLines.push(
      `${indent}<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${twClasses(node, ctx)}>${inner}</svg>`,
    );
  } else {
    const viewBox = (p.viewBox as string) || '0 0 24 24';
    const width = parseInt(String(p.width || size), 10) || size;
    const height = parseInt(String(p.height || size), 10) || size;
    const fill = (p.fill as string) || 'none';
    const stroke = (p.stroke as string) || 'currentColor';
    const content = (p.content as string) || '';
    ctx.templateLines.push(
      `${indent}<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${twClasses(node, ctx)}>${content}</svg>`,
    );
  }
}

function renderImage(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const src = (p.src as string) || '';
  if (src.startsWith('http')) {
    ctx.templateLines.push(`${indent}<img src="${src}" alt="${src}"${twClasses(node, ctx)} />`);
  } else {
    ctx.templateLines.push(`${indent}<img :src="'/${src}.png'" alt="${src}"${twClasses(node, ctx)} />`);
  }
}

function renderList(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  ctx.templateLines.push(`${indent}<div${twClasses(node, ctx, 'space-y-2')}>`);
  renderChildren(node, ctx, indent);
  ctx.templateLines.push(`${indent}</div>`);
}

function renderItem(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const hasChildren = node.children?.some((c) => !NON_VISUAL.has(c.type));
  ctx.templateLines.push(
    `${indent}<div${twClasses(node, ctx, 'flex items-center justify-between py-3 px-1 border-b border-zinc-800')}>`,
  );
  if (hasChildren) {
    renderChildren(node, ctx, indent);
  }
  ctx.templateLines.push(`${indent}</div>`);
}

function renderTabs(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const tabs = (node.children || []).filter((c) => c.type === 'tab');
  if (tabs.length === 0) {
    ctx.templateLines.push(`${indent}<div${twClasses(node, ctx)}>`);
    renderChildren(node, ctx, indent);
    ctx.templateLines.push(`${indent}</div>`);
    return;
  }

  ctx.vueImports.add('ref');
  const tabIdx = ctx.stateDecls.length;
  const tabVarName = `activeTab_${tabIdx}`;
  const firstTabName = (getProps(tabs[0]).name as string) || '0';
  ctx.stateDecls.push({ name: tabVarName, initial: `'${firstTabName}'` });

  ctx.templateLines.push(`${indent}<div${twClasses(node, ctx)}>`);
  ctx.templateLines.push(`${indent}  <div class="flex gap-2 mb-4">`);
  for (const tab of tabs) {
    const tp = getProps(tab);
    const tabName = (tp.name as string) || (tp.label as string) || 'tab';
    const label = (tp.label as string) || (tp.name as string) || 'Tab';
    ctx.templateLines.push(
      `${indent}    <button @click="${tabVarName} = '${tabName}'" :class="{ 'font-bold': ${tabVarName} === '${tabName}' }" class="px-3 py-1 text-sm rounded">${label}</button>`,
    );
  }
  ctx.templateLines.push(`${indent}  </div>`);

  for (const tab of tabs) {
    const tp = getProps(tab);
    const tabName = (tp.name as string) || (tp.label as string) || 'tab';
    ctx.templateLines.push(`${indent}  <div v-if="${tabVarName} === '${tabName}'">`);
    if (tab.children) {
      for (const child of tab.children) {
        renderNode(child, ctx, `${indent}    `);
      }
    }
    ctx.templateLines.push(`${indent}  </div>`);
  }
  ctx.templateLines.push(`${indent}</div>`);
}

function renderTab(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  // Handled by renderTabs parent — standalone tab renders as button
  const p = getProps(node);
  const label = (p.label as string) || '';
  const icon = p.icon as string;
  ctx.templateLines.push(
    `${indent}<button${twClasses(node, ctx, 'flex flex-col items-center gap-1 text-xs text-zinc-500')}>`,
  );
  if (icon) {
    const inner = SVG_ICON_INNER[icon] || '<circle cx="12" cy="12" r="4"/>';
    ctx.templateLines.push(
      `${indent}  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`,
    );
  }
  ctx.templateLines.push(`${indent}  ${tText(ctx, camelKey(label), label)}`);
  ctx.templateLines.push(`${indent}</button>`);
}

function renderProgress(node: IRNode, ctx: TwVueBuilder, indent: string): void {
  const p = getProps(node);
  const label = p.label || '';
  const current = Number(p.current || 0);
  const target = Number(p.target || 100);
  const color = (p.color as string) || '#007AFF';
  const pct = Math.round((current / target) * 100);

  ctx.templateLines.push(`${indent}<div class="mb-4">`);
  ctx.templateLines.push(`${indent}  <div class="flex justify-between text-sm mb-1.5">`);
  ctx.templateLines.push(`${indent}    <span class="font-semibold text-white">${label}</span>`);
  ctx.templateLines.push(`${indent}    <span class="text-zinc-400">${current}/${target} ${p.unit || ''}</span>`);
  ctx.templateLines.push(`${indent}  </div>`);
  ctx.templateLines.push(`${indent}  <div class="h-1.5 rounded-full overflow-hidden bg-zinc-800">`);
  ctx.templateLines.push(
    `${indent}    <div class="h-full rounded-full transition-all" :style="{ width: '${pct}%', backgroundColor: '${color}' }" />`,
  );
  ctx.templateLines.push(`${indent}  </div>`);
  ctx.templateLines.push(`${indent}</div>`);
}

// ── Script Setup Generation ──────────────────────────────────────────────

function generateScriptSetup(ctx: TwVueBuilder): string {
  const lines: string[] = [];

  // Vue imports
  if (ctx.vueImports.size > 0) {
    lines.push(`import { ${[...ctx.vueImports].sort().join(', ')} } from 'vue';`);
    lines.push('');
  }

  // i18n import — use Vue-native defaults, override React defaults from resolveConfig
  if (ctx.i18nEnabled) {
    const rawHook = ctx.config?.i18n?.hookName;
    const rawImport = ctx.config?.i18n?.importPath;
    // Override React-style defaults from resolveConfig
    const hookName = rawHook && rawHook !== 'useTranslation' ? rawHook : 'useI18n';
    const importPath = rawImport && rawImport !== 'react-i18next' ? rawImport : 'vue-i18n';
    lines.push(`import { ${hookName} } from '${importPath}';`);
    lines.push('');
    lines.push(`const { t } = ${hookName}();`);
    lines.push('');
  }

  // State → ref()
  for (const s of ctx.stateDecls) {
    const initial = s.initial;
    if (initial === undefined || initial === 'undefined') {
      lines.push(`const ${s.name} = ref();`);
    } else if (initial === 'true' || initial === 'false' || !Number.isNaN(Number(initial))) {
      lines.push(`const ${s.name} = ref(${initial});`);
    } else if (
      initial.startsWith("'") ||
      initial.startsWith('"') ||
      initial.startsWith('[') ||
      initial.startsWith('{')
    ) {
      lines.push(`const ${s.name} = ref(${initial});`);
    } else {
      lines.push(`const ${s.name} = ref('${initial}');`);
    }
  }
  if (ctx.stateDecls.length > 0) lines.push('');

  // Logic blocks
  for (const block of ctx.logicBlocks) {
    lines.push(block);
    lines.push('');
  }

  // Event handlers
  for (const handler of ctx.eventHandlers) {
    const asyncKw = handler.isAsync ? 'async ' : '';
    const keyGuard = handler.key ? `  if ((e as KeyboardEvent).key !== '${handler.key}') return;\n` : '';

    const needsMounted =
      handler.event === 'key' || handler.event === 'keydown' || handler.event === 'keyup' || handler.event === 'resize';

    if (needsMounted) {
      const param = handler.paramType || '';
      lines.push(`${asyncKw}function ${handler.fnName}(${param}) {`);
      if (keyGuard) lines.push(keyGuard.trimEnd());
      if (handler.code) {
        for (const line of handler.code.split('\n')) {
          lines.push(`  ${line}`);
        }
      }
      lines.push('}');
      lines.push('');

      const domEvent = handler.event === 'key' ? 'keydown' : handler.event;
      lines.push(`onMounted(() => {`);
      lines.push(`  window.addEventListener('${domEvent}', ${handler.fnName} as EventListener);`);
      lines.push(`});`);
      lines.push('');
      lines.push(`onUnmounted(() => {`);
      lines.push(`  window.removeEventListener('${domEvent}', ${handler.fnName} as EventListener);`);
      lines.push(`});`);
      lines.push('');
    } else {
      const param = handler.paramType || '';
      lines.push(`${asyncKw}function ${handler.fnName}(${param}) {`);
      if (handler.code) {
        for (const line of handler.code.split('\n')) {
          lines.push(`  ${line}`);
        }
      }
      lines.push('}');
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Main Transpiler ──────────────────────────────────────────────────────

import { buildVueStructuredArtifacts } from './artifact-utils-vue.js';
import { planVueStructure } from './structure-vue.js';

export function transpileTailwindVue(root: IRNode, config?: ResolvedKernConfig): TranspileResult {
  // Structured output path
  if (config && config.structure !== 'flat') {
    const plan = planVueStructure(root, config);
    if (plan) {
      return _transpileTailwindVueStructured(root, config, plan);
    }
  }
  // Flat output path (default)
  return _transpileTailwindVueFlat(root, config);
}

function _buildTailwindVueSFC(
  root: IRNode,
  config?: ResolvedKernConfig,
): { code: string; sourceMap: SourceMapEntry[] } {
  const ctx = createBuilder(config);
  collectThemes(root, ctx);
  renderNode(root, ctx, '  ');
  const scriptSetup = generateScriptSetup(ctx);

  const sfc: string[] = [];
  sfc.push('<script setup lang="ts">');
  if (scriptSetup.trim()) {
    sfc.push(scriptSetup.trimEnd());
  }
  sfc.push('</script>');
  sfc.push('');
  sfc.push('<template>');
  sfc.push(...ctx.templateLines);
  sfc.push('</template>');

  return { code: `${sfc.join('\n')}\n`, sourceMap: ctx.sourceMap };
}

function _transpileTailwindVueFlat(root: IRNode, config?: ResolvedKernConfig): TranspileResult {
  const { code, sourceMap } = _buildTailwindVueSFC(root, config);

  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(code);
  const tokenReduction = tsTokenCount > 0 ? Math.round((1 - irTokenCount / tsTokenCount) * 100) : 0;

  return {
    code,
    sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    diagnostics: (() => {
      const accounted = new Map<IRNode, AccountedEntry>();
      accountNode(accounted, root, 'expressed', undefined, true);
      const CONSUMED = new Set(['state', 'logic', 'on', 'theme', 'handler']);
      for (const child of root.children || []) {
        if (CONSUMED.has(child.type)) accountNode(accounted, child, 'consumed', `${child.type} pre-pass`, true);
      }
      return buildDiagnostics(root, accounted, 'tailwind-vue');
    })(),
  };
}

function _transpileTailwindVueStructured(
  root: IRNode,
  config: ResolvedKernConfig,
  plan: import('./structure-vue.js').StructurePlan,
): TranspileResult {
  const { entryCode, artifacts } = buildVueStructuredArtifacts(
    plan,
    (file, cfg) => _buildTailwindVueSFC(file.rootNode, cfg).code,
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
    diagnostics: (() => {
      const accounted = new Map<IRNode, AccountedEntry>();
      accountNode(accounted, root, 'expressed', undefined, true);
      const CONSUMED = new Set(['state', 'logic', 'on', 'theme', 'handler']);
      for (const child of root.children || []) {
        if (CONSUMED.has(child.type)) accountNode(accounted, child, 'consumed', `${child.type} pre-pass`, true);
      }
      return buildDiagnostics(root, accounted, 'tailwind-vue');
    })(),
  };
}
