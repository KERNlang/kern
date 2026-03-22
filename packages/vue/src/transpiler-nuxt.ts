/**
 * Nuxt 3 Transpiler — extends Vue 3 SFC output with Nuxt conventions.
 *
 * Differences from plain Vue:
 * - Pages go in pages/ with file-based routing
 * - Layouts go in layouts/
 * - Middleware go in middleware/
 * - Server routes go in server/api/
 * - Auto-imports assumed (no explicit 'import { ref } from "vue"')
 * - Uses Nuxt composables: useHead, useRoute, navigateTo
 */

import type { IRNode, TranspileResult, SourceMapEntry, ResolvedKernConfig, GeneratedArtifact } from '@kernlang/core';
import { expandStyles, countTokens, serializeIR, cssPropertyName, getProps, getStyles, getThemeRefs } from '@kernlang/core';

// ── Node → HTML Element Mapping (same as Vue) ───────────────────────────

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

function textElement(variant?: string): string {
  if (!variant) return 'p';
  const map: Record<string, string> = { h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', caption: 'small', small: 'small', code: 'code' };
  return map[variant] || 'p';
}

function cssValue(key: string, value: string | number): string {
  if (typeof value === 'number') {
    const unitless = ['flex', 'fontWeight', 'opacity', 'zIndex', 'lineHeight'];
    if (unitless.some(u => key.toLowerCase().includes(u.toLowerCase()))) return String(value);
    return `${value}px`;
  }
  return String(value);
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
  if (event === 'mouseover' || event === 'mouseout' || event === 'mouseenter' || event === 'mouseleave') return 'e: MouseEvent';
  return 'e: Event';
}

// ── Build Context ────────────────────────────────────────────────────────

interface NuxtBuilder {
  templateLines: string[];
  scriptLines: string[];
  stateDecls: Array<{ name: string; initial: string }>;
  eventHandlers: EventHandlerDecl[];
  logicBlocks: string[];
  cssRules: Map<string, Record<string, string | number>>;
  sourceMap: SourceMapEntry[];
  classIdx: number;
  themes: Record<string, Record<string, string>>;
  hasHead: boolean;
  headMeta: Record<string, string>;
  config: ResolvedKernConfig | undefined;
}

function createBuilder(config?: ResolvedKernConfig): NuxtBuilder {
  return {
    templateLines: [],
    scriptLines: [],
    stateDecls: [],
    eventHandlers: [],
    logicBlocks: [],
    cssRules: new Map(),
    sourceMap: [],
    classIdx: 0,
    themes: {},
    hasHead: false,
    headMeta: {},
    config,
  };
}

// ── Theme Collection ─────────────────────────────────────────────────────

function collectThemes(node: IRNode, ctx: NuxtBuilder): void {
  if (node.type === 'theme' && node.props?.styles) {
    const keys = Object.keys(node.props).filter(k => k !== 'styles' && k !== 'pseudoStyles' && k !== 'themeRefs');
    const name = keys[0] || `theme_${ctx.classIdx++}`;
    ctx.themes[name] = node.props.styles as Record<string, string>;
  }
  if (node.children) node.children.forEach(c => collectThemes(c, ctx));
}

// ── Style helpers ────────────────────────────────────────────────────────

function addClass(ctx: NuxtBuilder, nodeType: string, styles: Record<string, string | number>): string {
  if (Object.keys(styles).length === 0) return '';
  const className = `${nodeType}-${ctx.classIdx++}`;
  ctx.cssRules.set(className, styles);
  return className;
}

function mergeNodeStyles(node: IRNode, ctx: NuxtBuilder): Record<string, string | number> {
  let merged: Record<string, string | number> = {};
  for (const ref of getThemeRefs(node)) {
    if (ctx.themes[ref]) merged = { ...merged, ...expandStyles(ctx.themes[ref]) };
  }
  const styles = getStyles(node);
  if (Object.keys(styles).length > 0) merged = { ...merged, ...expandStyles(styles) };
  return merged;
}

function addLayoutDefaults(nodeType: string, styles: Record<string, string | number>): Record<string, string | number> {
  const s = { ...styles };
  if (nodeType === 'screen') { if (!s.display) s.display = 'flex'; if (!s.flexDirection) s.flexDirection = 'column'; if (!s.minHeight) s.minHeight = '100vh'; }
  if (nodeType === 'row') { if (!s.display) s.display = 'flex'; if (!s.flexDirection) s.flexDirection = 'row'; }
  if (nodeType === 'col') { if (!s.display) s.display = 'flex'; if (!s.flexDirection) s.flexDirection = 'column'; }
  if (nodeType === 'card') { if (!s.boxShadow) s.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'; }
  if (nodeType === 'grid') { if (!s.display) s.display = 'grid'; }
  if (nodeType === 'scroll') { if (!s.overflow) s.overflow = 'auto'; }
  return s;
}

// ── Event Handler Collection ─────────────────────────────────────────────

function collectOnHandler(node: IRNode, ctx: NuxtBuilder): void {
  const props = getProps(node);
  const event = (props.event || props.name) as string;
  const handlerRef = props.handler as string;
  const key = props.key as string;
  const isAsync = props.async === 'true' || props.async === true;

  const handlerChild = (node.children || []).find(c => c.type === 'handler');
  const code = handlerChild ? (getProps(handlerChild).code as string || '') : '';

  if (handlerRef && !code) return;

  const fnName = handlerRef || `handle${event.charAt(0).toUpperCase() + event.slice(1)}`;
  const paramType = eventParamType(event);

  ctx.eventHandlers.push({ event, fnName, code, isAsync, key, paramType });
}

// ── Node-specific Attribute Builders ─────────────────────────────────────

function addButtonAttrs(node: IRNode, props: Record<string, unknown>, attrs: string[]): string {
  let el = 'button';
  if (props.to) {
    el = 'NuxtLink';
    attrs.push(`:to="'/${props.to}'"`);
  }
  if (props.action) attrs.push(`@click="${props.action}"`);
  return el;
}

function addImageAttrs(props: Record<string, unknown>, attrs: string[]): void {
  if (props.src) {
    attrs.push(`:src="'/${props.src}.png'"`);
    attrs.push(`alt="${props.src}"`);
  }
}

function addInputAttrs(props: Record<string, unknown>, attrs: string[]): void {
  if (props.bind) attrs.push(`v-model="${props.bind}"`);
  if (props.placeholder) attrs.push(`placeholder="${props.placeholder}"`);
  if (props.type) attrs.push(`type="${props.type}"`);
}

function addListAttrs(props: Record<string, unknown>, attrs: string[]): void {
  if (props.items) {
    const itemVar = props.itemVar as string || 'item';
    attrs.push(`v-for="${itemVar} in ${props.items}" :key="${itemVar}.id || ${itemVar}"`);
  }
}

function addProgressAttrs(props: Record<string, unknown>, attrs: string[]): void {
  if (props.current) attrs.push(`:value="${props.current}"`);
  if (props.target) attrs.push(`:max="${props.target}"`);
}

// ── Node-specific Content Renderers ──────────────────────────────────────

function renderTextContent(props: Record<string, unknown>, ctx: NuxtBuilder, indent: string): void {
  if (!props.value) return;
  const val = props.value as string;
  if (typeof val === 'string' && val.startsWith('{{') && val.endsWith('}}')) {
    ctx.templateLines.push(`${indent}  {{ ${val.slice(2, -2).trim()} }}`);
  } else {
    ctx.templateLines.push(`${indent}  ${val}`);
  }
}

function renderTabs(node: IRNode, ctx: NuxtBuilder, indent: string, el: string): void {
  const tabs = (node.children || []).filter(c => c.type === 'tab');
  if (tabs.length === 0) return;
  const tabVarName = `activeTab_${ctx.classIdx}`;
  const firstTabName = (getProps(tabs[0]).name as string) || '0';
  ctx.stateDecls.push({ name: tabVarName, initial: `'${firstTabName}'` });

  ctx.templateLines.push(`${indent}  <div class="tab-buttons">`);
  for (const tab of tabs) {
    const tp = getProps(tab);
    const tabName = tp.name as string || 'tab';
    const label = tp.label as string || tp.name as string || 'Tab';
    ctx.templateLines.push(`${indent}    <button @click="${tabVarName} = '${tabName}'" :class="{ active: ${tabVarName} === '${tabName}' }">${label}</button>`);
  }
  ctx.templateLines.push(`${indent}  </div>`);

  for (const tab of tabs) {
    const tp = getProps(tab);
    const tabName = tp.name as string || 'tab';
    ctx.templateLines.push(`${indent}  <div v-if="${tabVarName} === '${tabName}'">`);
    if (tab.children) {
      for (const child of tab.children) {
        renderNode(child, ctx, indent + '    ');
      }
    }
    ctx.templateLines.push(`${indent}  </div>`);
  }
}

function renderChildren(node: IRNode, ctx: NuxtBuilder, indent: string): void {
  if (node.children) {
    for (const child of node.children) {
      renderNode(child, ctx, indent + '  ');
    }
  }
}

// ── Skipped props for generic passthrough ────────────────────────────────

const NON_VISUAL = new Set(['state', 'logic', 'theme', 'handler', 'metadata', 'on']);

// ── Template rendering ───────────────────────────────────────────────────

function renderNode(node: IRNode, ctx: NuxtBuilder, indent: string): void {
  const props = getProps(node);

  switch (node.type) {
    case 'state':
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
    case 'metadata':
      ctx.hasHead = true;
      if (props.title) ctx.headMeta.title = props.title as string;
      if (props.description) ctx.headMeta.description = props.description as string;
      return;
    default:
      break;
  }

  let el = node.type === 'text'
    ? textElement(props.variant as string | undefined)
    : NODE_TO_ELEMENT[node.type] || 'div';

  let styles = mergeNodeStyles(node, ctx);
  styles = addLayoutDefaults(node.type, styles);
  const className = addClass(ctx, node.type, styles);

  const attrs: string[] = [];
  if (className) attrs.push(`class="${className}"`);

  // Node-specific attributes (button may override el to NuxtLink)
  if (node.type === 'button') el = addButtonAttrs(node, props as Record<string, unknown>, attrs);
  else if (node.type === 'image') addImageAttrs(props as Record<string, unknown>, attrs);
  else if (node.type === 'input') addInputAttrs(props as Record<string, unknown>, attrs);
  else if (node.type === 'list') addListAttrs(props as Record<string, unknown>, attrs);
  else if (node.type === 'progress') addProgressAttrs(props as Record<string, unknown>, attrs);

  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  const selfClosing = ['image', 'divider', 'input'].includes(node.type);

  const hasContent = (node.children && node.children.some(c => !NON_VISUAL.has(c.type))) ||
    (node.type === 'text' && props.value) ||
    (node.type === 'button' && props.text) ||
    (node.type === 'section' && props.title);

  if (selfClosing && !hasContent) {
    ctx.templateLines.push(`${indent}<${el}${attrStr} />`);
    return;
  }

  ctx.templateLines.push(`${indent}<${el}${attrStr}>`);

  if (node.type === 'text') renderTextContent(props as Record<string, unknown>, ctx, indent);
  if (node.type === 'button' && props.text) ctx.templateLines.push(`${indent}  ${props.text}`);
  if (node.type === 'section' && props.title) ctx.templateLines.push(`${indent}  <h2>${props.title}</h2>`);

  if (node.type === 'tabs') {
    renderTabs(node, ctx, indent, el);
  } else {
    renderChildren(node, ctx, indent);
  }

  ctx.templateLines.push(`${indent}</${el}>`);
}

// ── CSS Generation ───────────────────────────────────────────────────────

function generateScopedCSS(ctx: NuxtBuilder): string {
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

// ── Route path from node name ────────────────────────────────────────────

function inferRoutePath(name: string): string {
  // PascalCase → kebab-case, "Index" or "Home" → index
  if (name === 'Index' || name === 'Home') return 'index';
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

// ── Determine output structure (page vs layout vs middleware) ─────────────

function classifyNuxtNode(node: IRNode): 'page' | 'layout' | 'middleware' | 'server' | 'component' {
  const props = getProps(node);
  if (node.type === 'layout') return 'layout';
  if (node.type === 'middleware' || props.middleware === 'true') return 'middleware';
  if (node.type === 'route' || props.route === 'true') return 'server';
  if (node.type === 'page' || node.type === 'screen') return 'page';
  return 'component';
}

// ── Script setup (Nuxt: no explicit vue imports) ─────────────────────────

function generateScriptSetup(ctx: NuxtBuilder): string {
  const lines: string[] = [];

  // Nuxt: auto-imports ref, computed, watch — no explicit import needed

  // useHead for metadata
  if (ctx.hasHead) {
    const headEntries: string[] = [];
    if (ctx.headMeta.title) headEntries.push(`  title: '${ctx.headMeta.title}'`);
    if (ctx.headMeta.description) {
      headEntries.push(`  meta: [{ name: 'description', content: '${ctx.headMeta.description}' }]`);
    }
    lines.push(`useHead({`);
    lines.push(headEntries.join(',\n'));
    lines.push(`});`);
    lines.push('');
  }

  // State → ref() (auto-imported)
  for (const s of ctx.stateDecls) {
    const initial = s.initial;
    if (initial === undefined || initial === 'undefined') {
      lines.push(`const ${s.name} = ref();`);
    } else if (initial === 'true' || initial === 'false' || !isNaN(Number(initial))) {
      lines.push(`const ${s.name} = ref(${initial});`);
    } else if (initial.startsWith("'") || initial.startsWith('"') || initial.startsWith('[') || initial.startsWith('{')) {
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

    const needsMounted = handler.event === 'key' || handler.event === 'keydown' ||
                         handler.event === 'keyup' || handler.event === 'resize';

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

      // Nuxt auto-imports onMounted/onUnmounted — no explicit import needed
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
      // Generate a plain function for template-bound events
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

export function transpileNuxt(root: IRNode, config?: ResolvedKernConfig): TranspileResult {
  const ctx = createBuilder(config);
  const rootProps = getProps(root);
  const name = rootProps.name as string || 'Page';

  collectThemes(root, ctx);
  renderNode(root, ctx, '  ');

  const scriptSetup = generateScriptSetup(ctx);
  const scopedCSS = generateScopedCSS(ctx);

  // Assemble SFC
  const sfc: string[] = [];

  // Nuxt script setup — no explicit vue imports
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

  const code = sfc.join('\n') + '\n';

  // Generate artifacts for Nuxt file structure
  const nodeType = classifyNuxtNode(root);
  const artifacts: GeneratedArtifact[] = [];
  const routePath = inferRoutePath(name);

  if (nodeType === 'page') {
    artifacts.push({
      path: `pages/${routePath}.vue`,
      content: code,
      type: 'page',
    });
  } else if (nodeType === 'layout') {
    artifacts.push({
      path: `layouts/${routePath}.vue`,
      content: code,
      type: 'layout',
    });
  } else if (nodeType === 'middleware') {
    // Middleware is a TS file, not SFC
    const mwCode = generateMiddleware(root);
    artifacts.push({
      path: `middleware/${routePath}.ts`,
      content: mwCode,
      type: 'middleware',
    });
  } else if (nodeType === 'server') {
    // Server route — Nuxt convention: users.post.ts, users.get.ts
    const method = (rootProps.method as string || 'get').toLowerCase();
    const serverCode = generateServerRoute(root);
    const methodSuffix = method !== 'get' ? `.${method}` : '';
    artifacts.push({
      path: `server/api/${routePath}${methodSuffix}.ts`,
      content: serverCode,
      type: 'route',
    });
  }

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
    artifacts: artifacts.length > 0 ? artifacts : undefined,
  };
}

// ── Middleware Generation ─────────────────────────────────────────────────

function generateMiddleware(node: IRNode): string {
  const props = getProps(node);
  const name = props.name as string || 'middleware';
  const handler = (node.children || []).find(c => c.type === 'handler');
  const code = handler ? (getProps(handler).code as string || '') : '';

  const lines: string[] = [];
  lines.push(`export default defineNuxtRouteMiddleware((to, from) => {`);
  if (code) {
    const dedented = code.split('\n');
    const nonEmpty = dedented.filter(l => l.trim().length > 0);
    const min = nonEmpty.length > 0 ? Math.min(...nonEmpty.map(l => l.match(/^(\s*)/)?.[1].length ?? 0)) : 0;
    for (const line of dedented) {
      lines.push(`  ${line.slice(min)}`);
    }
  }
  lines.push(`});`);
  return lines.join('\n') + '\n';
}

// ── Server Route Generation ──────────────────────────────────────────────

function generateServerRoute(node: IRNode): string {
  const props = getProps(node);
  const method = (props.method as string || 'get').toLowerCase();
  const handler = (node.children || []).find(c => c.type === 'handler');
  const code = handler ? (getProps(handler).code as string || '') : '';

  const lines: string[] = [];
  lines.push(`export default defineEventHandler(async (event) => {`);
  if (code) {
    const dedented = code.split('\n');
    const nonEmpty = dedented.filter(l => l.trim().length > 0);
    const min = nonEmpty.length > 0 ? Math.min(...nonEmpty.map(l => l.match(/^(\s*)/)?.[1].length ?? 0)) : 0;
    for (const line of dedented) {
      lines.push(`  ${line.slice(min)}`);
    }
  }
  lines.push(`});`);
  return lines.join('\n') + '\n';
}
