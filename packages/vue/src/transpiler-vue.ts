/**
 * Vue 3 SFC Transpiler — generates <script setup> + <template> + <style scoped>
 *
 * Maps the same KERN IR nodes to Vue Single File Components instead of React TSX.
 * Core language nodes (type, interface, fn, machine, etc.) already produce pure TS
 * via @kernlang/core — this transpiler only handles UI nodes.
 */

import type { AccountedEntry, IRNode, ResolvedKernConfig, SourceMapEntry, TranspileResult } from '@kernlang/core';
import {
  accountNode,
  buildDiagnostics,
  camelKey,
  countTokens,
  cssPropertyName,
  escapeJsString,
  expandStyles,
  getProps,
  getStyles,
  getThemeRefs,
  serializeIR,
} from '@kernlang/core';

// ── Node → HTML Element Mapping ──────────────────────────────────────────

const NODE_TO_ELEMENT: Record<string, string> = {
  screen: 'div',
  row: 'div',
  col: 'div',
  card: 'div',
  scroll: 'div',
  text: 'p',
  image: 'img',
  button: 'button',
  input: 'input',
  modal: 'dialog',
  list: 'ul',
  item: 'li',
  tabs: 'div',
  tab: 'button',
  header: 'header',
  divider: 'hr',
  progress: 'progress',
  section: 'section',
  form: 'form',
  grid: 'div',
};

// ── Semantic elements for text variants ──────────────────────────────────

function textElement(variant?: string): string {
  if (!variant) return 'p';
  if (variant === 'h1') return 'h1';
  if (variant === 'h2') return 'h2';
  if (variant === 'h3') return 'h3';
  if (variant === 'h4') return 'h4';
  if (variant === 'h5') return 'h5';
  if (variant === 'h6') return 'h6';
  if (variant === 'caption' || variant === 'small') return 'small';
  if (variant === 'code') return 'code';
  return 'p';
}

// ── i18n helper ──────────────────────────────────────────────────────────

function tText(ctx: VueBuilder, key: string, value: string): string {
  return ctx.i18nEnabled ? `{{ t('${escapeJsString(key)}', '${escapeJsString(value)}') }}` : value;
}

// ── Style helpers ────────────────────────────────────────────────────────

function cssValue(key: string, value: string | number): string {
  if (typeof value === 'number') {
    const unitless = ['flex', 'fontWeight', 'opacity', 'zIndex', 'lineHeight'];
    if (unitless.some((u) => key.toLowerCase().includes(u.toLowerCase()))) return String(value);
    return `${value}px`;
  }
  return String(value);
}

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

interface VueBuilder {
  templateLines: string[];
  scriptImports: Set<string>;
  vueImports: Set<string>;
  stateDecls: StateDecl[];
  eventHandlers: EventHandlerDecl[];
  logicBlocks: string[];
  cssRules: Map<string, Record<string, string | number>>;
  sourceMap: SourceMapEntry[];
  classIdx: number;
  themes: Record<string, Record<string, string>>;
  config: ResolvedKernConfig | undefined;
  i18nEnabled: boolean;
}

function createBuilder(config?: ResolvedKernConfig): VueBuilder {
  return {
    templateLines: [],
    scriptImports: new Set(),
    vueImports: new Set(),
    stateDecls: [],
    eventHandlers: [],
    logicBlocks: [],
    cssRules: new Map(),
    sourceMap: [],
    classIdx: 0,
    themes: {},
    config,
    i18nEnabled: config?.i18n?.enabled ?? false,
  };
}

// ── Theme Collection ─────────────────────────────────────────────────────

function collectThemes(node: IRNode, ctx: VueBuilder): void {
  if (node.type === 'theme' && node.props) {
    const props = node.props as Record<string, unknown>;
    if (props.styles) {
      const name = (props.name as string) || `theme_${ctx.classIdx++}`;
      ctx.themes[name] = props.styles as Record<string, string>;
    }
  }
  if (node.children) node.children.forEach((c) => collectThemes(c, ctx));
}

// ── CSS Class Generation ─────────────────────────────────────────────────

function addClass(ctx: VueBuilder, nodeType: string, styles: Record<string, string | number>): string {
  if (Object.keys(styles).length === 0) return '';
  const className = `${nodeType}-${ctx.classIdx++}`;
  ctx.cssRules.set(className, styles);
  return className;
}

function mergeNodeStyles(node: IRNode, ctx: VueBuilder): Record<string, string | number> {
  let merged: Record<string, string | number> = {};
  const themeRefs = getThemeRefs(node);
  for (const ref of themeRefs) {
    if (ctx.themes[ref]) {
      merged = { ...merged, ...expandStyles(ctx.themes[ref]) };
    }
  }
  const styles = getStyles(node);
  if (Object.keys(styles).length > 0) {
    merged = { ...merged, ...expandStyles(styles) };
  }
  return merged;
}

function addLayoutDefaults(nodeType: string, styles: Record<string, string | number>): Record<string, string | number> {
  const s = { ...styles };
  if (nodeType === 'screen') {
    if (!s.display) s.display = 'flex';
    if (!s.flexDirection) s.flexDirection = 'column';
    if (!s.minHeight) s.minHeight = '100vh';
  }
  if (nodeType === 'row') {
    if (!s.display) s.display = 'flex';
    if (!s.flexDirection) s.flexDirection = 'row';
  }
  if (nodeType === 'col') {
    if (!s.display) s.display = 'flex';
    if (!s.flexDirection) s.flexDirection = 'column';
  }
  if (nodeType === 'card') {
    if (!s.boxShadow) s.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
  }
  if (nodeType === 'grid') {
    if (!s.display) s.display = 'grid';
  }
  if (nodeType === 'scroll') {
    if (!s.overflow) s.overflow = 'auto';
  }
  return s;
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
  if (event === 'mouseover' || event === 'mouseout' || event === 'mouseenter' || event === 'mouseleave')
    return 'e: MouseEvent';
  return 'e: Event';
}

function collectOnHandler(node: IRNode, ctx: VueBuilder): void {
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

  // Events that need onMounted + addEventListener (global/window events)
  const needsMounted = event === 'key' || event === 'keydown' || event === 'keyup' || event === 'resize';
  if (needsMounted) {
    ctx.vueImports.add('onMounted');
    ctx.vueImports.add('onUnmounted');
  }

  ctx.eventHandlers.push({ event, fnName, code, isAsync, key, paramType });
}

// ── Node-specific Attribute Builders ─────────────────────────────────────

function addImageAttrs(props: Record<string, unknown>, attrs: string[]): void {
  if (props.src) {
    attrs.push(`:src="'/${props.src}.png'"`);
    attrs.push(`alt="${props.src}"`);
  }
}

function addButtonAttrs(props: Record<string, unknown>, attrs: string[]): void {
  if (props.to) attrs.push(`@click="$router.push('/${props.to}')"`);
  if (props.action) attrs.push(`@click="${props.action}"`);
}

function addInputAttrs(props: Record<string, unknown>, attrs: string[]): void {
  if (props.bind) attrs.push(`v-model="${props.bind}"`);
  if (props.placeholder) attrs.push(`placeholder="${props.placeholder}"`);
  if (props.type) attrs.push(`type="${props.type}"`);
}

function addListAttrs(props: Record<string, unknown>, attrs: string[]): void {
  if (props.items) {
    const itemVar = (props.itemVar as string) || 'item';
    attrs.push(`v-for="${itemVar} in ${props.items}" :key="${itemVar}.id || ${itemVar}"`);
  }
}

function addProgressAttrs(props: Record<string, unknown>, attrs: string[]): void {
  if (props.current) attrs.push(`:value="${props.current}"`);
  if (props.target) attrs.push(`:max="${props.target}"`);
}

const ATTR_BUILDERS: Record<string, (props: Record<string, unknown>, attrs: string[], ctx: VueBuilder) => void> = {
  image: (p, a) => addImageAttrs(p, a),
  button: (p, a) => addButtonAttrs(p, a),
  input: (p, a) => addInputAttrs(p, a),
  modal: (_p, a) => a.push(':open="true"'),
  list: (p, a) => addListAttrs(p, a),
  progress: (p, a) => addProgressAttrs(p, a),
  tabs: (_p, _a, ctx) => ctx.vueImports.add('ref'),
};

// ── Node-specific Content Renderers ──────────────────────────────────────

function renderTextContent(props: Record<string, unknown>, ctx: VueBuilder, indent: string): void {
  if (!props.value) return;
  const rawVal = props.value;
  // Expression object: { __expr: true, code: "count" } → {{ count }}
  if (typeof rawVal === 'object' && rawVal !== null && '__expr' in rawVal) {
    ctx.templateLines.push(`${indent}  {{ ${(rawVal as unknown as { code: string }).code} }}`);
    return;
  }
  const val = rawVal as string;
  if (typeof val !== 'string') return;
  if (val.startsWith('{{') && val.endsWith('}}')) {
    ctx.templateLines.push(`${indent}  {{ ${val.slice(2, -2).trim()} }}`);
  } else {
    const key = (props.key as string) || camelKey(val);
    ctx.templateLines.push(`${indent}  ${tText(ctx, key, val)}`);
  }
}

function renderProgressContent(props: Record<string, unknown>, ctx: VueBuilder, indent: string): void {
  if (!props.label) return;
  const current = props.current || 0;
  const target = props.target || 100;
  const unit = props.unit || '';
  ctx.templateLines.push(`${indent}  ${props.label}: ${current}/${target} ${unit}`);
}

function renderTabs(node: IRNode, ctx: VueBuilder, indent: string, _el: string): void {
  const tabs = (node.children || []).filter((c) => c.type === 'tab');
  if (tabs.length === 0) return;
  const tabVarName = `activeTab_${ctx.classIdx}`;
  const firstTabName = (getProps(tabs[0]).name as string) || '0';
  ctx.stateDecls.push({ name: tabVarName, initial: `'${firstTabName}'` });

  ctx.templateLines.push(`${indent}  <div class="tab-buttons">`);
  for (const tab of tabs) {
    const tp = getProps(tab);
    const tabName = (tp.name as string) || (tp.label as string) || 'tab';
    const label = (tp.label as string) || (tp.name as string) || 'Tab';
    ctx.templateLines.push(
      `${indent}    <button @click="${tabVarName} = '${tabName}'" :class="{ active: ${tabVarName} === '${tabName}' }">${label}</button>`,
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
}

function renderChildren(node: IRNode, ctx: VueBuilder, indent: string): void {
  if (node.children) {
    for (const child of node.children) {
      renderNode(child, ctx, `${indent}  `);
    }
  }
}

// ── Skipped props for generic passthrough ────────────────────────────────

const SKIP_PROPS = new Set([
  'styles',
  'pseudoStyles',
  'themeRefs',
  'value',
  'text',
  'src',
  'name',
  'variant',
  'to',
  'action',
  'bind',
  'placeholder',
  'type',
  'items',
  'itemVar',
  'current',
  'target',
  'unit',
  'color',
  'label',
  'icon',
  'title',
  'active',
  'initial',
  'code',
]);

const NON_VISUAL = new Set(['state', 'logic', 'theme', 'handler', 'on']);

// ── Template Rendering ───────────────────────────────────────────────────

function renderNode(node: IRNode, ctx: VueBuilder, indent: string): void {
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

  const el =
    node.type === 'text' ? textElement(props.variant as string | undefined) : NODE_TO_ELEMENT[node.type] || 'div';

  let styles = mergeNodeStyles(node, ctx);
  styles = addLayoutDefaults(node.type, styles);
  const className = addClass(ctx, node.type, styles);

  const attrs: string[] = [];
  if (className) attrs.push(`class="${className}"`);

  const attrBuilder = ATTR_BUILDERS[node.type];
  if (attrBuilder) attrBuilder(props as Record<string, unknown>, attrs, ctx);

  for (const [k, v] of Object.entries(props)) {
    if (SKIP_PROPS.has(k)) continue;
    attrs.push(`${k}="${v}"`);
  }

  const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';

  const hasContent =
    node.children?.some((c) => !NON_VISUAL.has(c.type)) ||
    (node.type === 'text' && props.value) ||
    (node.type === 'button' && props.text) ||
    (node.type === 'progress' && props.label) ||
    (node.type === 'section' && props.title);

  const selfClosing = ['image', 'divider', 'input'].includes(node.type) && !hasContent;

  if (selfClosing) {
    ctx.templateLines.push(`${indent}<${el}${attrStr} />`);
    return;
  }

  ctx.templateLines.push(`${indent}<${el}${attrStr}>`);

  if (node.type === 'text') renderTextContent(props as Record<string, unknown>, ctx, indent);
  if (node.type === 'button' && props.text) ctx.templateLines.push(`${indent}  ${props.text}`);
  if (node.type === 'section' && props.title) ctx.templateLines.push(`${indent}  <h2>${props.title}</h2>`);
  if (node.type === 'progress') renderProgressContent(props as Record<string, unknown>, ctx, indent);

  if (node.type === 'tabs') {
    renderTabs(node, ctx, indent, el);
  } else {
    renderChildren(node, ctx, indent);
  }

  ctx.templateLines.push(`${indent}</${el}>`);
}

// ── CSS Rule Generation ──────────────────────────────────────────────────

function generateScopedCSS(ctx: VueBuilder): string {
  if (ctx.cssRules.size === 0) return '';

  const lines: string[] = [];
  for (const [className, styles] of ctx.cssRules) {
    lines.push(`.${className} {`);
    for (const [key, value] of Object.entries(styles)) {
      lines.push(`  ${cssPropertyName(key)}: ${cssValue(key, value)};`);
    }
    lines.push('}');
    lines.push('');
  }
  return lines.join('\n');
}

// ── Script Setup Generation ──────────────────────────────────────────────

function generateScriptSetup(ctx: VueBuilder, root: IRNode): string {
  const lines: string[] = [];
  const _props = getProps(root);

  // Vue imports
  if (ctx.vueImports.size > 0) {
    lines.push(`import { ${[...ctx.vueImports].sort().join(', ')} } from 'vue';`);
    lines.push('');
  }

  // i18n import — use Vue-native defaults, override React defaults from resolveConfig
  if (ctx.i18nEnabled) {
    const rawHook = ctx.config?.i18n?.hookName;
    const rawImport = ctx.config?.i18n?.importPath;
    const hookName = rawHook && rawHook !== 'useTranslation' ? rawHook : 'useI18n';
    const importPath = rawImport && rawImport !== 'react-i18next' ? rawImport : 'vue-i18n';
    lines.push(`import { ${hookName} } from '${importPath}';`);
    lines.push('');
    lines.push(`const { t } = ${hookName}();`);
    lines.push('');
  }

  // Script-level imports
  for (const imp of ctx.scriptImports) {
    lines.push(imp);
  }
  if (ctx.scriptImports.size > 0) lines.push('');

  // Component props via defineProps
  const propNodes = (root.children || []).filter((c) => c.type === 'prop');
  if (propNodes.length > 0) {
    lines.push('const props = defineProps<{');
    for (const pn of propNodes) {
      const pp = getProps(pn);
      const opt = pp.optional === 'true' || pp.optional === true ? '?' : '';
      lines.push(`  ${pp.name}${opt}: ${pp.type};`);
    }
    lines.push('}>()');
    lines.push('');
  }

  // Emits
  const emitNodes = (root.children || []).filter((c) => c.type === 'emit');
  if (emitNodes.length > 0) {
    const _emitNames = emitNodes.map((e) => `'${getProps(e).name}'`).join(' | ');
    lines.push(`const emit = defineEmits<{`);
    for (const e of emitNodes) {
      const ep = getProps(e);
      const payload = (ep.type as string) || 'void';
      lines.push(`  (e: '${ep.name}', payload: ${payload}): void;`);
    }
    lines.push(`}>()`);
    lines.push('');
  }

  // State → ref()
  for (const s of ctx.stateDecls) {
    const initial = s.initial;
    // Detect type from initial value
    if (initial === undefined || initial === 'undefined') {
      lines.push(`const ${s.name} = ref();`);
    } else if (initial === 'true' || initial === 'false') {
      lines.push(`const ${s.name} = ref(${initial});`);
    } else if (!Number.isNaN(Number(initial))) {
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

    // For key/resize events, generate a plain function + onMounted/onUnmounted
    const needsMounted =
      handler.event === 'key' || handler.event === 'keydown' || handler.event === 'keyup' || handler.event === 'resize';

    if (needsMounted) {
      // Generate the function
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

      // Generate onMounted + onUnmounted for window event listener
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
      // Generate a plain function for template-bound events (click, submit, etc.)
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

export function transpileVue(root: IRNode, config?: ResolvedKernConfig): TranspileResult {
  const ctx = createBuilder(config);

  // Collect themes
  collectThemes(root, ctx);

  // Render template
  renderNode(root, ctx, '  ');

  // Build script setup
  const scriptSetup = generateScriptSetup(ctx, root);

  // Build scoped CSS
  const scopedCSS = generateScopedCSS(ctx);

  // Assemble SFC
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

  if (scopedCSS.trim()) {
    sfc.push('');
    sfc.push('<style scoped>');
    sfc.push(scopedCSS.trimEnd());
    sfc.push('</style>');
  }

  const code = `${sfc.join('\n')}\n`;

  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(code);
  const tokenReduction = tsTokenCount > 0 ? Math.round((1 - irTokenCount / tsTokenCount) * 100) : 0;

  return {
    code,
    sourceMap: ctx.sourceMap,
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
      return buildDiagnostics(root, accounted, 'vue');
    })(),
  };
}
