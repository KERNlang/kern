import type { IRNode, TranspileResult, SourceMapEntry, ResolvedKernConfig, GeneratedArtifact, TailwindVersionProfile, NextjsVersionProfile } from '@kernlang/core';
import { stylesToTailwind, colorToTw, countTokens, serializeIR, camelKey, escapeJsxText, escapeJsxAttr, escapeJsString, buildTailwindProfile, buildNextjsProfile, applyTailwindTokenRules } from '@kernlang/core';
import { planStructure } from './structure.js';
import type { PlannedFile } from './structure.js';
import { buildStructuredArtifacts } from './artifact-utils.js';

/**
 * Next.js App Router Transpiler
 *
 * Extends the Tailwind transpiler with Next.js-specific features:
 * - page / layout / loading / error node types → file conventions
 * - metadata node → generateMetadata export
 * - Server vs client components (client=true flag)
 * - next/link, next/image, next/navigation imports
 * - Multi-file output via TranspileResult.files
 */

// ── Next.js specific types ──────────────────────────────────────────────

interface NextFile {
  path: string;
  content: string;
}

interface NextTranspileResult extends TranspileResult {
  files: NextFile[];
}

// ── Code generation context ─────────────────────────────────────────────

interface JSImportSpec {
  defaultImport?: string;
  namedImports: Set<string>;
  typeOnlyImports: Set<string>;
}

interface FetchCall {
  name: string;
  url: string;
  options?: string;
}

interface GenerateMetadataInfo {
  handlerCode: string;
}

interface Ctx {
  lines: string[];
  sourceMap: SourceMapEntry[];
  imports: Map<string, JSImportSpec>;
  componentImports: Set<string>;
  isClient: boolean;
  isAsync: boolean;
  metadata: Record<string, string> | null;
  generateMetadataInfo: GenerateMetadataInfo | null;
  fetchCalls: FetchCall[];
  bodyLines: string[];
  colors: Record<string, string> | undefined;
  twProfile: TailwindVersionProfile | undefined;
  njProfile: NextjsVersionProfile | undefined;
}

function getProps(node: IRNode): Record<string, unknown> { return node.props || {}; }
function getStyles(node: IRNode): Record<string, string> { return (getProps(node).styles as Record<string, string>) || {}; }

// ── Unified import helpers (from Codex) ──────────────────────────────────

function addDefaultImport(ctx: Ctx, source: string, name: string): void {
  const spec = ctx.imports.get(source) || { namedImports: new Set<string>(), typeOnlyImports: new Set<string>() };
  spec.defaultImport = name;
  ctx.imports.set(source, spec);
}

function addNamedImport(ctx: Ctx, source: string, name: string, typeOnly?: boolean): void {
  const spec = ctx.imports.get(source) || { namedImports: new Set<string>(), typeOnlyImports: new Set<string>() };
  if (typeOnly) {
    spec.typeOnlyImports.add(name);
  } else {
    spec.namedImports.add(name);
  }
  ctx.imports.set(source, spec);
}

function exprCode(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null && '__expr' in value) {
    return (value as unknown as { code: string }).code;
  }
  if (typeof value === 'string' && value.length > 0) return value;
  return fallback;
}

function emitImports(ctx: Ctx): string[] {
  const lines: string[] = [];
  for (const [source, spec] of [...ctx.imports.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // Separate type-only imports from value imports
    const typeImports = [...spec.typeOnlyImports].filter(n => !spec.namedImports.has(n));
    const valueImports = [...spec.namedImports];

    // Emit type-only import statement if there are type imports and no value imports sharing the source
    if (typeImports.length > 0 && valueImports.length === 0 && !spec.defaultImport) {
      lines.push(`import type { ${typeImports.sort().join(', ')} } from '${source}';`);
    } else {
      // Emit value import (with default if present)
      const clauses: string[] = [];
      if (spec.defaultImport) clauses.push(spec.defaultImport);
      if (valueImports.length > 0) clauses.push(`{ ${valueImports.sort().join(', ')} }`);
      if (clauses.length > 0) {
        lines.push(`import ${clauses.join(', ')} from '${source}';`);
      }
      // Emit separate type-only import if both type and value imports exist
      if (typeImports.length > 0) {
        lines.push(`import type { ${typeImports.sort().join(', ')} } from '${source}';`);
      }
    }
  }
  return lines;
}

function twClasses(node: IRNode, ctx: Ctx, extra: string = ''): string {
  let tw = stylesToTailwind(getStyles(node), ctx.colors);
  if (ctx.twProfile) tw = applyTailwindTokenRules(tw, ctx.twProfile);
  const parts = [tw, extra].filter(Boolean);
  return parts.length > 0 ? ` className="${parts.join(' ')}"` : '';
}

// ── Route path helper ────────────────────────────────────────────────────

function routeToPath(route: string, segment?: string): string {
  // Normalize: strip leading/trailing slashes
  const normalized = route.replace(/^\/+|\/+$/g, '');
  const parts = normalized ? normalized.split('/') : [];
  if (segment) parts.push(segment);
  return parts.length > 0 ? parts.join('/') + '/' : '';
}

// ── Node renderers ──────────────────────────────────────────────────────

function renderNode(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  ctx.sourceMap.push({ irLine: node.loc?.line || 0, irCol: node.loc?.col || 1, outLine: ctx.lines.length + 1, outCol: 1 });

  switch (node.type) {
    case 'page': case 'screen': renderPage(node, ctx, indent); break;
    case 'layout': renderLayout(node, ctx, indent); break;
    case 'loading': renderLoading(node, ctx, indent); break;
    case 'error': renderError(node, ctx, indent); break;
    case 'metadata': renderMetadata(node, ctx); break;
    case 'section': renderSection(node, ctx, indent); break;
    case 'card': renderCard(node, ctx, indent); break;
    case 'row': ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'flex')}>`); renderChildren(node, ctx, indent); ctx.lines.push(`${indent}</div>`); break;
    case 'col': ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'flex flex-col')}>`); renderChildren(node, ctx, indent); ctx.lines.push(`${indent}</div>`); break;
    case 'text': renderText(node, ctx, indent); break;
    case 'divider': ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'h-px')} />`); break;
    case 'button': renderButton(node, ctx, indent); break;
    case 'link': renderLink(node, ctx, indent); break;
    case 'image': renderImage(node, ctx, indent); break;
    case 'codeblock': renderCodeBlock(node, ctx, indent); break;
    case 'input': ctx.lines.push(`${indent}<input${twClasses(node, ctx)} />`); break;
    case 'slider': renderSlider(node, ctx, indent); break;
    case 'toggle': renderToggle(node, ctx, indent); break;
    case 'grid': renderGrid(node, ctx, indent); break;
    case 'conditional': renderConditional(node, ctx, indent); break;
    case 'component': renderComponent(node, ctx, indent); break;
    case 'icon': ctx.componentImports.add('Icon'); ctx.lines.push(`${indent}<Icon name="${p.name}" size="sm"${twClasses(node, ctx)} />`); break;
    case 'list': ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'space-y-2')}>`); renderChildren(node, ctx, indent); ctx.lines.push(`${indent}</div>`); break;
    case 'item': ctx.lines.push(`${indent}<div${twClasses(node, ctx)}>`); renderChildren(node, ctx, indent); ctx.lines.push(`${indent}</div>`); break;
    case 'progress': renderProgress(node, ctx, indent); break;
    case 'tabs': ctx.lines.push(`${indent}<nav${twClasses(node, ctx, 'flex')}>`); renderChildren(node, ctx, indent); ctx.lines.push(`${indent}</nav>`); break;
    case 'tab': ctx.lines.push(`${indent}<button${twClasses(node, ctx)}>${escapeJsxText(String(p.label || ''))}</button>`); break;
    case 'generateMetadata': renderGenerateMetadata(node, ctx); break;
    case 'notFound': renderNotFound(node, ctx, indent); break;
    case 'redirect': renderRedirect(node, ctx, indent); break;
    case 'import': renderImport(node, ctx); break;
    case 'fetch': renderFetchNode(node, ctx); break;
    case 'on': renderOnHandler(node, ctx); return;
    case 'theme': break;
    default:
      ctx.lines.push(`${indent}<div${twClasses(node, ctx)}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</div>`);
  }
}

function renderChildren(node: IRNode, ctx: Ctx, indent: string): void {
  if (node.children) for (const child of node.children) renderNode(child, ctx, indent + '  ');
}

function renderPage(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  if (p.client === 'true' || p.client === true) ctx.isClient = true;
  if (p.async === 'true' || p.async === true) ctx.isAsync = true;
  ctx.lines.push(`${indent}<div${twClasses(node, ctx)}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderLayout(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  ctx.lines.push(`${indent}<html lang="${p.lang || 'en'}">`);
  ctx.lines.push(`${indent}  <body${twClasses(node, ctx)}>`);
  ctx.lines.push(`${indent}    {children}`);
  renderChildren(node, ctx, indent + '  ');
  ctx.lines.push(`${indent}  </body>`);
  ctx.lines.push(`${indent}</html>`);
}

function renderLoading(node: IRNode, ctx: Ctx, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'animate-pulse')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderError(node: IRNode, ctx: Ctx, indent: string): void {
  ctx.isClient = true;
  ctx.lines.push(`${indent}<div${twClasses(node, ctx)}>`);
  ctx.lines.push(`${indent}  <h2>Something went wrong!</h2>`);
  ctx.lines.push(`${indent}  <button onClick={() => reset()}>Try again</button>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderMetadata(node: IRNode, ctx: Ctx): void {
  const p = getProps(node);
  ctx.metadata = {};
  if (p.title) ctx.metadata.title = p.title as string;
  if (p.description) ctx.metadata.description = p.description as string;
  if (p.keywords) ctx.metadata.keywords = p.keywords as string;
  if (p.ogImage) ctx.metadata.ogImage = p.ogImage as string;
}

function renderSection(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const title = p.title as string || '';
  const id = p.id as string;
  const idAttr = id ? ` id="${id}"` : '';
  const tw = twClasses(node, ctx);
  ctx.lines.push(`${indent}<section${idAttr}${tw}>`);
  if (title) {
    ctx.lines.push(`${indent}  <h2 className="text-lg font-semibold mb-4">${escapeJsxText(title)}</h2>`);
  }
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</section>`);
}

function renderCodeBlock(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const lang = p.lang as string || '';
  const langClass = lang ? ` language-${lang}` : '';
  // Content: inline value prop or body child node
  let content = p.value as string || '';
  if (!content && node.children) {
    const bodyNode = node.children.find(c => c.type === 'body');
    if (bodyNode) {
      const bp = getProps(bodyNode);
      content = bp.value as string || '';
    }
  }
  // Escape for JSX template literal: backslashes, backticks, ${
  const escaped = content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  ctx.lines.push(`${indent}<pre className="bg-zinc-900 rounded-lg p-4 overflow-x-auto">`);
  ctx.lines.push(`${indent}  <code className="text-sm font-mono text-zinc-100${langClass}">{\`${escaped}\`}</code>`);
  ctx.lines.push(`${indent}</pre>`);
}

function renderCard(node: IRNode, ctx: Ctx, indent: string): void {
  const styles = { ...getStyles(node) };
  const border = styles.border;
  delete styles.border;
  // Use a shallow-copied styles object to avoid mutating the live IR node
  if (node.props) {
    const origStyles = node.props.styles;
    node.props.styles = styles;
    const extra = border ? `border ${colorToTw('border', border, ctx.colors)}` : '';
    ctx.lines.push(`${indent}<div${twClasses(node, ctx, extra)}>`);
    renderChildren(node, ctx, indent);
    ctx.lines.push(`${indent}</div>`);
    node.props.styles = origStyles;
  } else {
    const extra = border ? `border ${colorToTw('border', border, ctx.colors)}` : '';
    ctx.lines.push(`${indent}<div${twClasses(node, ctx, extra)}>`);
    renderChildren(node, ctx, indent);
    ctx.lines.push(`${indent}</div>`);
  }
}

const TEXT_TAG_MAP: Record<string, string> = { p: 'p', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', label: 'label', span: 'span' };

function renderText(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const value = p.value as string;
  const bind = p.bind as string;
  const el = TEXT_TAG_MAP[p.tag as string] || 'span';
  const tw = twClasses(node, ctx);
  if (bind) ctx.lines.push(`${indent}<${el}${tw}>{${bind}}</${el}>`);
  else if (value) ctx.lines.push(`${indent}<${el}${tw}>${escapeJsxText(value)}</${el}>`);
}

function renderButton(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const text = p.text as string || '';
  const to = p.to as string;
  const onClick = p.onClick as string;
  if (to) {
    addDefaultImport(ctx, 'next/link', 'Link');
    ctx.lines.push(`${indent}<Link href="/${to.toLowerCase()}"${twClasses(node, ctx)}>${escapeJsxText(text)}</Link>`);
  } else {
    ctx.lines.push(`${indent}<button${twClasses(node, ctx)} onClick={${onClick || '() => {}'}}>${escapeJsxText(text)}</button>`);
  }
}

function renderLink(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  addDefaultImport(ctx, 'next/link', 'Link');
  ctx.lines.push(`${indent}<Link href="${p.to || '/'}"${twClasses(node, ctx)}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</Link>`);
}

function renderImage(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  addDefaultImport(ctx, 'next/image', 'Image');
  const tw = twClasses(node, ctx);
  const rawSrc = p.src as string || '';
  const src = (rawSrc.startsWith('/') || rawSrc.includes('://') || rawSrc.includes('.')) ? rawSrc : `/${rawSrc}.png`;
  const alt = escapeJsxAttr(String(p.alt || p.src || ''));
  const fill = p.fill === 'true' || p.fill === true;
  const priority = p.priority === 'true' || p.priority === true;
  if (fill) {
    ctx.lines.push(`${indent}<Image src="${src}" alt="${alt}"${priority ? ' priority' : ''} fill${tw} />`);
  } else {
    const width = p.width || (getStyles(node).w) || '100';
    const height = p.height || (getStyles(node).h) || '100';
    ctx.lines.push(`${indent}<Image src="${src}" alt="${alt}" width={${width}} height={${height}}${priority ? ' priority' : ''}${tw} />`);
  }
}

function renderSlider(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const bind = p.bind as string;
  const setter = bind ? `set${bind.charAt(0).toUpperCase() + bind.slice(1)}` : 'setValue';
  ctx.lines.push(`${indent}<input type="range" min={${p.min || 0}} max={${p.max || 100}} step={${p.step || 1}} value={${bind || 'value'}} onChange={(e) => ${setter}(parseFloat(e.target.value))} className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-orange-500" />`);
}

function renderToggle(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const bind = p.bind as string;
  const setter = bind ? `set${bind.charAt(0).toUpperCase() + bind.slice(1)}` : 'setValue';
  ctx.lines.push(`${indent}<label className="relative inline-flex items-center cursor-pointer">`);
  ctx.lines.push(`${indent}  <input type="checkbox" className="sr-only peer" checked={${bind || 'value'}} onChange={(e) => ${setter}(e.target.checked)} />`);
  ctx.lines.push(`${indent}  <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600" />`);
  ctx.lines.push(`${indent}</label>`);
}

function renderOnHandler(node: IRNode, ctx: Ctx): void {
  const p = getProps(node);
  const event = (p.event || p.name) as string;
  const handlerRef = p.handler as string;
  const key = p.key as string;
  const isAsync = p.async === 'true' || p.async === true;

  const handlerChild = (node.children || []).find(c => c.type === 'handler');
  const code = handlerChild ? (getProps(handlerChild).code as string || '') : '';

  if (handlerRef && !code) return;

  ctx.isClient = true; // event handlers require 'use client'
  const fnName = handlerRef || `handle${event.charAt(0).toUpperCase() + event.slice(1)}`;
  const asyncKw = isAsync ? 'async ' : '';

  const paramType = event === 'submit' ? 'e: React.FormEvent'
    : event === 'click' ? 'e: React.MouseEvent'
    : event === 'change' ? 'e: React.ChangeEvent'
    : event === 'key' || event === 'keydown' || event === 'keyup' ? 'e: React.KeyboardEvent'
    : event === 'focus' || event === 'blur' ? 'e: React.FocusEvent'
    : event === 'scroll' ? 'e: React.UIEvent'
    : `e: React.SyntheticEvent`;

  const keyGuard = key ? `    if (e.key !== '${key}') return;\n` : '';

  addNamedImport(ctx, 'react', 'useCallback');
  let block = `  const ${fnName} = useCallback(${asyncKw}(${paramType}) => {\n`;
  if (keyGuard) block += keyGuard;
  if (code) {
    for (const line of code.split('\n')) {
      block += `    ${line}\n`;
    }
  }
  block += `  }, []);\n`;
  ctx.bodyLines.push(block);

  if (event === 'key' || event === 'keydown' || event === 'keyup') {
    addNamedImport(ctx, 'react', 'useEffect');
    const domEvent = event === 'key' ? 'keydown' : event;
    let effect = `  useEffect(() => {\n`;
    effect += `    const listener = (e: KeyboardEvent) => ${fnName}(e as unknown as React.KeyboardEvent);\n`;
    effect += `    window.addEventListener('${domEvent}', listener);\n`;
    effect += `    return () => window.removeEventListener('${domEvent}', listener);\n`;
    effect += `  }, [${fnName}]);\n`;
    ctx.bodyLines.push(effect);
  }

  if (event === 'resize') {
    addNamedImport(ctx, 'react', 'useEffect');
    let effect = `  useEffect(() => {\n`;
    effect += `    window.addEventListener('resize', ${fnName});\n`;
    effect += `    return () => window.removeEventListener('resize', ${fnName});\n`;
    effect += `  }, [${fnName}]);\n`;
    ctx.bodyLines.push(effect);
  }
}

function renderGrid(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  ctx.lines.push(`${indent}<div className="grid grid-cols-1 md:grid-cols-${p.cols || 1} gap-${Math.round(Number(p.gap || 16) / 4)}">`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderConditional(node: IRNode, ctx: Ctx, indent: string): void {
  const cond = (getProps(node).if as string || 'true').replace(/&/g, ' && ').replace(/([a-zA-Z_]+)=([a-zA-Z_]+)/g, "$1 === '$2'");
  ctx.lines.push(`${indent}{${cond} && (`);
  ctx.lines.push(`${indent}  <>`);
  renderChildren(node, ctx, indent + '  ');
  ctx.lines.push(`${indent}  </>`);
  ctx.lines.push(`${indent})}`);
}

function renderComponent(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const ref = p.ref as string;
  if (!ref) return;
  ctx.componentImports.add(ref);
  const hasOnChange = 'onChange' in p;
  const attrs: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (['ref', 'styles', 'pseudoStyles', 'themeRefs'].includes(k)) continue;
    if (k === 'bind') { attrs.push(`value={${v}}`); if (!hasOnChange) attrs.push(`onChange={set${(v as string).charAt(0).toUpperCase() + (v as string).slice(1)}}`); }
    else if (k === 'onChange') attrs.push(`onChange={${v}}`);
    else if (k === 'props') { for (const pn of (v as string).split(',')) attrs.push(`${pn.trim()}={${pn.trim()}}`); }
    else if (k === 'disabled') attrs.push(`disabled={${(v as string).replace(/&/g, ' && ').replace(/([a-zA-Z_]+)=([a-zA-Z_]+)/g, "$1 === '$2'")}}`);
    else if (k === 'default') attrs.push(`defaultValue={${JSON.stringify(v)}}`);
    else attrs.push(`${k}={${JSON.stringify(v)}}`);
  }
  ctx.lines.push(`${indent}<${ref}${attrs.length ? ' ' + attrs.join(' ') : ''} />`);
}

function renderProgress(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const current = Number(p.current || 0), target = Number(p.target || 100);
  const pct = Math.round((current / target) * 100);
  ctx.lines.push(`${indent}<div className="mb-3">`);
  ctx.lines.push(`${indent}  <div className="flex justify-between text-sm mb-1"><span>${escapeJsxText(String(p.label || ''))}</span><span>${current}/${target} ${escapeJsxText(String(p.unit || ''))}</span></div>`);
  ctx.lines.push(`${indent}  <div className="h-2 bg-zinc-700 rounded-full overflow-hidden"><div className="h-full rounded-full bg-[${p.color || '#007AFF'}]" style={{ width: '${pct}%' }} /></div>`);
  ctx.lines.push(`${indent}</div>`);
}

// ── Next.js 15 production pattern renderers ─────────────────────────────

function renderGenerateMetadata(node: IRNode, ctx: Ctx): void {
  // Collect handler code from children
  let handlerCode = '';
  if (node.children) {
    for (const child of node.children) {
      const cp = getProps(child);
      if (child.type === 'handler' && cp.code) {
        handlerCode = cp.code as string;
      }
    }
  }
  // Also check inline code prop
  const p = getProps(node);
  if (p.code) handlerCode = p.code as string;

  ctx.generateMetadataInfo = { handlerCode };
}

function renderNotFound(node: IRNode, ctx: Ctx, _indent: string): void {
  addNamedImport(ctx, 'next/navigation', 'notFound');
  const p = getProps(node);
  const condition = p.if;

  if (condition) {
    ctx.bodyLines.push(`  if (${exprCode(condition, 'true')}) { notFound(); }`);
  } else {
    ctx.bodyLines.push(`  notFound();`);
  }
}

function renderRedirect(node: IRNode, ctx: Ctx, _indent: string): void {
  addNamedImport(ctx, 'next/navigation', 'redirect');
  const p = getProps(node);
  const to = p.to as string || '/';
  ctx.bodyLines.push(`  redirect('${to}');`);
}

function renderImport(node: IRNode, ctx: Ctx): void {
  const p = getProps(node);
  const name = p.name as string;
  const from = p.from as string;
  const isDefault = p.default === 'true' || p.default === true;

  if (name && from) {
    if (isDefault) {
      addDefaultImport(ctx, from, name);
    } else {
      addNamedImport(ctx, from, name);
    }
  }
}

function renderFetchNode(node: IRNode, ctx: Ctx): void {
  const p = getProps(node);
  const name = p.name as string || 'data';
  const url = p.url as string || '/api/data';
  const options = p.options as string;
  ctx.fetchCalls.push({ name, url, options });
}

// ── Main export ─────────────────────────────────────────────────────────

export function transpileNextjs(root: IRNode, config?: ResolvedKernConfig): NextTranspileResult {
  // Structured output path
  if (config && config.structure !== 'flat') {
    const plan = planStructure(root, config);
    if (plan) {
      return _transpileNextjsStructured(root, config, plan);
    }
  }
  // Flat output path (default — unchanged)
  return _transpileNextjsInner(root, config);
}

function _transpileNextjsInner(root: IRNode, config?: ResolvedKernConfig): NextTranspileResult {
  const ctx: Ctx = {
    lines: [],
    sourceMap: [],
    imports: new Map(),
    componentImports: new Set(),
    isClient: false,
    isAsync: false,
    metadata: null,
    generateMetadataInfo: null,
    fetchCalls: [],
    bodyLines: [],
    colors: config?.colors,
    twProfile: config?.frameworkVersions ? buildTailwindProfile(config.frameworkVersions) : undefined,
    njProfile: config?.frameworkVersions ? buildNextjsProfile(config.frameworkVersions) : undefined,
  };

  // Check root for client flag
  const rootProps = getProps(root);
  if (rootProps.client === 'true' || rootProps.client === true) ctx.isClient = true;
  if (rootProps.async === 'true' || rootProps.async === true) ctx.isAsync = true;

  // renderNode already handles metadata nodes in the switch case
  renderNode(root, ctx, '    ');

  // If there are fetch calls, mark page as async
  if (ctx.fetchCalls.length > 0) ctx.isAsync = true;

  const name = (rootProps.name as string) || 'Page';
  const isLayout = root.type === 'layout';
  const isLoading = root.type === 'loading';
  const isError = root.type === 'error';

  const code: string[] = [];

  // 'use client' directive
  if (ctx.isClient) {
    code.push(`'use client';`);
    code.push('');
  }

  // Metadata type import for generateMetadata
  if (ctx.generateMetadataInfo && !ctx.isClient) {
    addNamedImport(ctx, 'next', 'Metadata', true);
  }

  // Component imports → add to unified import map
  const uiLib = config?.components?.uiLibrary ?? '@/components/ui';
  const compRoot = config?.components?.componentRoot ?? '@/components';
  if (ctx.componentImports.size > 0) {
    const uiImports = [...ctx.componentImports].filter(c => ['Icon', 'Button'].includes(c));
    const others = [...ctx.componentImports].filter(c => !['Icon', 'Button'].includes(c));
    for (const name of uiImports) addNamedImport(ctx, uiLib, name);
    for (const name of others) addDefaultImport(ctx, `${compRoot}/${name}`, name);
  }

  // Static metadata needs Metadata type
  if (ctx.metadata && !ctx.isClient && !ctx.generateMetadataInfo) {
    addNamedImport(ctx, 'next', 'Metadata', true);
  }

  // Emit all imports (unified, sorted)
  code.push(...emitImports(ctx));

  if (code.length > 0 && code[code.length - 1] !== '') code.push('');

  // Metadata export (server components only) -- static metadata
  if (ctx.metadata && !ctx.isClient) {
    const useSatisfies = ctx.njProfile?.outputRules.metadataStyle === 'satisfies';
    code.push(useSatisfies ? `export const metadata = {` : `export const metadata: Metadata = {`);
    for (const [k, v] of Object.entries(ctx.metadata)) {
      code.push(`  ${k}: '${escapeJsString(v)}',`);
    }
    code.push(useSatisfies ? `} satisfies Metadata;` : `};`);
    code.push('');
  }

  // generateMetadata export (server components only)
  if (ctx.generateMetadataInfo && !ctx.isClient) {
    const usePromiseParams = !ctx.njProfile || ctx.njProfile.major >= 15;
    const paramsType = usePromiseParams
      ? '{ params }: { params: Promise<Record<string, string>> }'
      : '{ params }: { params: Record<string, string> }';
    code.push('');
    code.push(`export async function generateMetadata(${paramsType}): Promise<Metadata> {`);
    if (ctx.generateMetadataInfo.handlerCode) {
      // Split handler code by newlines and emit each line as-is
      const lines = ctx.generateMetadataInfo.handlerCode.split('\n').map(s => s.trim()).filter(Boolean);
      for (const line of lines) {
        code.push(`  ${line}`);
      }
    } else {
      if (usePromiseParams) {
        code.push(`  const resolvedParams = await params;`);
        code.push(`  return { title: resolvedParams.slug ?? '' };`);
      } else {
        code.push(`  return { title: params.slug ?? '' };`);
      }
    }
    code.push(`}`);
    code.push('');
  }

  // Component
  if (isLayout) {
    code.push(`export default function ${name}({ children }: { children: React.ReactNode }) {`);
  } else if (isError) {
    code.push(`export default function ${name}({ error, reset }: { error: Error; reset: () => void }) {`);
  } else if (ctx.isAsync) {
    const usePromiseParams = !ctx.njProfile || ctx.njProfile.major >= 15;
    if (usePromiseParams) {
      code.push(`export default async function ${name}(props: { params: Promise<Record<string, string>> }) {`);
      code.push(`  const params = await props.params;`);
    } else {
      code.push(`export default async function ${name}({ params }: { params: Record<string, string> }) {`);
    }
  } else {
    code.push(`export default function ${name}() {`);
  }

  // Emit fetch calls (inside async function body, before return)
  for (const fc of ctx.fetchCalls) {
    if (fc.options) {
      code.push(`  const ${fc.name} = await fetch('${fc.url}', ${fc.options}).then(r => r.json());`);
    } else {
      code.push(`  const ${fc.name} = await fetch('${fc.url}').then(r => r.json());`);
    }
  }

  // Emit body lines (notFound, redirect calls)
  for (const line of ctx.bodyLines) {
    code.push(line);
  }

  code.push('  return (');
  code.push(...ctx.lines);
  code.push('  );');
  code.push('}');

  const output = code.join('\n');
  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(output);
  const tokenReduction = tsTokenCount > 0 ? Math.round((1 - irTokenCount / tsTokenCount) * 100) : 0;

  // Determine output filename convention (route-aware)
  const route = rootProps.route as string | undefined;
  const segment = rootProps.segment as string | undefined;
  const routePrefix = route ? routeToPath(route, segment) : (segment ? routeToPath('', segment) : '');
  const files: NextFile[] = [];
  if (isLayout) files.push({ path: `${routePrefix}layout.tsx`, content: output });
  else if (isLoading) files.push({ path: `${routePrefix}loading.tsx`, content: output });
  else if (isError) files.push({ path: `${routePrefix}error.tsx`, content: output });
  else files.push({ path: `${routePrefix}page.tsx`, content: output });

  return {
    code: output,
    sourceMap: ctx.sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    files,
  };
}

// ── Structured output ────────────────────────────────────────────────────

function _renderNextjsFile(file: PlannedFile, config: ResolvedKernConfig): string {
  const ctx: Ctx = {
    lines: [],
    sourceMap: [],
    imports: new Map(),
    componentImports: new Set(),
    isClient: false,
    isAsync: false,
    metadata: null,
    generateMetadataInfo: null,
    fetchCalls: [],
    bodyLines: [],
    colors: config.colors,
    twProfile: config.frameworkVersions ? buildTailwindProfile(config.frameworkVersions) : undefined,
    njProfile: config.frameworkVersions ? buildNextjsProfile(config.frameworkVersions) : undefined,
  };

  const rootNode = file.rootNode;
  const rootProps = rootNode.props || {};

  // Check client flag
  if (rootProps.client === 'true' || rootProps.client === true) ctx.isClient = true;
  if (rootProps.async === 'true' || rootProps.async === true) ctx.isAsync = true;

  // renderNode already handles metadata nodes in the switch case
  renderNode(rootNode, ctx, '    ');

  const name = file.componentName || (rootProps.name as string) || 'Component';
  const isLayout = rootNode.type === 'layout';
  const isError = rootNode.type === 'error';

  // 'use client' only when the component actually has client-side interactivity
  // (ctx.isClient is set during rendering by renderPage/renderError/client=true flag)

  const code: string[] = [];

  if (ctx.isClient) {
    code.push(`'use client';`);
    code.push('');
  }

  const uiLib = config.components?.uiLibrary ?? '@/components/ui';
  const compRoot = config.components?.componentRoot ?? '@/components';
  if (ctx.componentImports.size > 0) {
    const uiImports = [...ctx.componentImports].filter(c => ['Icon', 'Button'].includes(c));
    const others = [...ctx.componentImports].filter(c => !['Icon', 'Button'].includes(c));
    for (const name of uiImports) addNamedImport(ctx, uiLib, name);
    for (const name of others) addDefaultImport(ctx, `${compRoot}/${name}`, name);
  }

  // Metadata type import for generateMetadata
  if (ctx.generateMetadataInfo && !ctx.isClient) {
    addNamedImport(ctx, 'next', 'Metadata', true);
  }

  if (ctx.metadata && !ctx.isClient && !ctx.generateMetadataInfo) {
    addNamedImport(ctx, 'next', 'Metadata', true);
  }

  // If there are fetch calls, mark page as async
  if (ctx.fetchCalls.length > 0) ctx.isAsync = true;

  code.push(...emitImports(ctx));

  if (code.length > 0 && code[code.length - 1] !== '') code.push('');

  // Metadata (server components only)
  if (ctx.metadata && !ctx.isClient) {
    const useSatisfies = ctx.njProfile?.outputRules.metadataStyle === 'satisfies';
    code.push(useSatisfies ? `export const metadata = {` : `export const metadata: Metadata = {`);
    for (const [k, v] of Object.entries(ctx.metadata)) {
      code.push(`  ${k}: '${escapeJsString(v)}',`);
    }
    code.push(useSatisfies ? `} satisfies Metadata;` : `};`);
    code.push('');
  }

  // generateMetadata export (server components only)
  if (ctx.generateMetadataInfo && !ctx.isClient) {
    const usePromiseParams = !ctx.njProfile || ctx.njProfile.major >= 15;
    const paramsType = usePromiseParams
      ? '{ params }: { params: Promise<Record<string, string>> }'
      : '{ params }: { params: Record<string, string> }';
    code.push('');
    code.push(`export async function generateMetadata(${paramsType}): Promise<Metadata> {`);
    if (ctx.generateMetadataInfo.handlerCode) {
      const lines = ctx.generateMetadataInfo.handlerCode.split('\n').map(s => s.trim()).filter(Boolean);
      for (const line of lines) {
        code.push(`  ${line}`);
      }
    } else {
      if (usePromiseParams) {
        code.push(`  const resolvedParams = await params;`);
        code.push(`  return { title: resolvedParams.slug ?? '' };`);
      } else {
        code.push(`  return { title: params.slug ?? '' };`);
      }
    }
    code.push(`}`);
    code.push('');
  }

  if (isLayout) {
    code.push(`export default function ${name}({ children }: { children: React.ReactNode }) {`);
  } else if (isError) {
    code.push(`export default function ${name}({ error, reset }: { error: Error; reset: () => void }) {`);
  } else if (ctx.isAsync) {
    const usePromiseParams = !ctx.njProfile || ctx.njProfile.major >= 15;
    if (usePromiseParams) {
      code.push(`export default async function ${name}(props: { params: Promise<Record<string, string>> }) {`);
      code.push(`  const params = await props.params;`);
    } else {
      code.push(`export default async function ${name}({ params }: { params: Record<string, string> }) {`);
    }
  } else {
    code.push(`export default function ${name}() {`);
  }

  // Emit fetch calls (inside async function body, before return)
  for (const fc of ctx.fetchCalls) {
    if (fc.options) {
      code.push(`  const ${fc.name} = await fetch('${fc.url}', ${fc.options}).then(r => r.json());`);
    } else {
      code.push(`  const ${fc.name} = await fetch('${fc.url}').then(r => r.json());`);
    }
  }

  // Emit body lines (notFound, redirect calls)
  for (const line of ctx.bodyLines) {
    code.push(line);
  }

  code.push('  return (');
  code.push(...ctx.lines);
  code.push('  );');
  code.push('}');

  return code.join('\n');
}

function _transpileNextjsStructured(
  root: IRNode,
  config: ResolvedKernConfig,
  plan: import('./structure.js').StructurePlan,
): NextTranspileResult {
  const { entryCode, artifacts } = buildStructuredArtifacts(
    plan,
    (file, cfg) => _renderNextjsFile(file, cfg),
    root,
    config,
  );

  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(entryCode);
  const tokenReduction = tsTokenCount > 0 ? Math.round((1 - irTokenCount / tsTokenCount) * 100) : 0;

  // Convert artifacts to NextFile[] for files property
  const files: NextFile[] = artifacts
    .filter(a => a.path.endsWith('.tsx'))
    .map(a => ({ path: a.path, content: a.content }));

  return {
    code: entryCode,
    sourceMap: [],
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    files,
    artifacts,
  };
}

