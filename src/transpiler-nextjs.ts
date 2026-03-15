import type { IRNode, TranspileResult, SourceMapEntry } from './types.js';
import type { ResolvedKernConfig } from './config.js';
import { stylesToTailwind, colorToTw } from './styles-tailwind.js';
import { countTokens, serializeIR, camelKey, escapeJsx } from './utils.js';

// ── Active config for current transpilation run ─────────────────────────

let _activeConfig: ResolvedKernConfig | undefined;

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

interface Ctx {
  lines: string[];
  sourceMap: SourceMapEntry[];
  imports: Set<string>;
  nextImports: Set<string>;
  componentImports: Set<string>;
  isClient: boolean;
  metadata: Record<string, string> | null;
}

function getProps(node: IRNode): Record<string, unknown> { return node.props || {}; }
function getStyles(node: IRNode): Record<string, string> { return (getProps(node).styles as Record<string, string>) || {}; }

function twClasses(node: IRNode, extra: string = ''): string {
  const tw = stylesToTailwind(getStyles(node), _activeConfig?.colors);
  const parts = [tw, extra].filter(Boolean);
  return parts.length > 0 ? ` className="${parts.join(' ')}"` : '';
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
    case 'row': ctx.lines.push(`${indent}<div${twClasses(node, 'flex')}>`); renderChildren(node, ctx, indent); ctx.lines.push(`${indent}</div>`); break;
    case 'col': ctx.lines.push(`${indent}<div${twClasses(node, 'flex flex-col')}>`); renderChildren(node, ctx, indent); ctx.lines.push(`${indent}</div>`); break;
    case 'text': renderText(node, ctx, indent); break;
    case 'divider': ctx.lines.push(`${indent}<div${twClasses(node, 'h-px')} />`); break;
    case 'button': renderButton(node, ctx, indent); break;
    case 'link': renderLink(node, ctx, indent); break;
    case 'image': renderImage(node, ctx, indent); break;
    case 'input': ctx.lines.push(`${indent}<input${twClasses(node)} />`); break;
    case 'slider': renderSlider(node, ctx, indent); break;
    case 'toggle': renderToggle(node, ctx, indent); break;
    case 'grid': renderGrid(node, ctx, indent); break;
    case 'conditional': renderConditional(node, ctx, indent); break;
    case 'component': renderComponent(node, ctx, indent); break;
    case 'icon': ctx.componentImports.add('Icon'); ctx.lines.push(`${indent}<Icon name="${p.name}" size="sm"${twClasses(node)} />`); break;
    case 'list': ctx.lines.push(`${indent}<div${twClasses(node, 'space-y-2')}>`); renderChildren(node, ctx, indent); ctx.lines.push(`${indent}</div>`); break;
    case 'item': ctx.lines.push(`${indent}<div${twClasses(node)}>`); renderChildren(node, ctx, indent); ctx.lines.push(`${indent}</div>`); break;
    case 'progress': renderProgress(node, ctx, indent); break;
    case 'tabs': ctx.lines.push(`${indent}<nav${twClasses(node, 'flex')}>`); renderChildren(node, ctx, indent); ctx.lines.push(`${indent}</nav>`); break;
    case 'tab': ctx.lines.push(`${indent}<button${twClasses(node)}>${p.label}</button>`); break;
    case 'theme': break;
    default:
      ctx.lines.push(`${indent}<div${twClasses(node)}>`);
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
  ctx.lines.push(`${indent}<div${twClasses(node)}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderLayout(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  ctx.lines.push(`${indent}<html lang="${p.lang || 'en'}">`);
  ctx.lines.push(`${indent}  <body${twClasses(node)}>`);
  ctx.lines.push(`${indent}    {children}`);
  renderChildren(node, ctx, indent + '  ');
  ctx.lines.push(`${indent}  </body>`);
  ctx.lines.push(`${indent}</html>`);
}

function renderLoading(node: IRNode, ctx: Ctx, indent: string): void {
  ctx.lines.push(`${indent}<div${twClasses(node, 'animate-pulse')}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderError(node: IRNode, ctx: Ctx, indent: string): void {
  ctx.isClient = true;
  ctx.lines.push(`${indent}<div${twClasses(node)}>`);
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
  const key = p.key as string || camelKey(title);
  ctx.lines.push(`${indent}<section>`);
  ctx.lines.push(`${indent}  <h2 className="text-lg font-semibold mb-4">${title}</h2>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</section>`);
}

function renderCard(node: IRNode, ctx: Ctx, indent: string): void {
  const styles = getStyles(node);
  const border = styles.border;
  delete styles.border;
  const extra = border ? `border ${colorToTw('border', border, _activeConfig?.colors)}` : '';
  ctx.lines.push(`${indent}<div${twClasses(node, extra)}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderText(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const value = p.value as string;
  const bind = p.bind as string;
  const el = (p.tag as string) === 'p' ? 'p' : (p.tag as string) === 'h1' ? 'h1' : (p.tag as string) === 'h2' ? 'h2' : (p.tag as string) === 'label' ? 'label' : 'span';
  const tw = twClasses(node);
  if (bind) ctx.lines.push(`${indent}<${el}${tw}>{${bind}}</${el}>`);
  else if (value) ctx.lines.push(`${indent}<${el}${tw}>${value}</${el}>`);
}

function renderButton(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const text = p.text as string || '';
  const to = p.to as string;
  const onClick = p.onClick as string;
  if (to) {
    ctx.nextImports.add('Link');
    ctx.lines.push(`${indent}<Link href="/${to.toLowerCase()}"${twClasses(node)}>${text}</Link>`);
  } else {
    ctx.lines.push(`${indent}<button${twClasses(node)} onClick={${onClick || '() => {}'}}>${text}</button>`);
  }
}

function renderLink(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  ctx.nextImports.add('Link');
  ctx.lines.push(`${indent}<Link href="${p.to || '/'}"${twClasses(node)}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</Link>`);
}

function renderImage(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  ctx.nextImports.add('Image');
  const tw = twClasses(node);
  const width = p.width || (getStyles(node).w) || '100';
  const height = p.height || (getStyles(node).h) || '100';
  ctx.lines.push(`${indent}<Image src="/${p.src}.png" alt="${p.alt || p.src}" width={${width}} height={${height}}${tw} />`);
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
  ctx.lines.push(`${indent}  <div className="flex justify-between text-sm mb-1"><span>${p.label}</span><span>${current}/${target} ${p.unit || ''}</span></div>`);
  ctx.lines.push(`${indent}  <div className="h-2 bg-zinc-700 rounded-full overflow-hidden"><div className="h-full rounded-full bg-[${p.color || '#007AFF'}]" style={{ width: '${pct}%' }} /></div>`);
  ctx.lines.push(`${indent}</div>`);
}

// ── Main export ─────────────────────────────────────────────────────────

export function transpileNextjs(root: IRNode, config?: ResolvedKernConfig): NextTranspileResult {
  _activeConfig = config;
  try {
  return _transpileNextjsInner(root, config);
  } finally {
    _activeConfig = undefined;
  }
}

function _transpileNextjsInner(root: IRNode, config?: ResolvedKernConfig): NextTranspileResult {
  const ctx: Ctx = {
    lines: [],
    sourceMap: [],
    imports: new Set(),
    nextImports: new Set(),
    componentImports: new Set(),
    isClient: false,
    metadata: null,
  };

  // Check root for client flag
  const rootProps = getProps(root);
  if (rootProps.client === 'true' || rootProps.client === true) ctx.isClient = true;

  // Check for metadata child
  if (root.children) {
    for (const child of root.children) {
      if (child.type === 'metadata') renderMetadata(child, ctx);
    }
  }

  renderNode(root, ctx, '    ');

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

  // Next.js imports
  if (ctx.nextImports.size > 0) {
    const linkImport = ctx.nextImports.has('Link');
    const imageImport = ctx.nextImports.has('Image');
    if (linkImport) code.push(`import Link from 'next/link';`);
    if (imageImport) code.push(`import Image from 'next/image';`);
  }

  // Component imports
  const uiLib = config?.components?.uiLibrary ?? '@/components/ui';
  const compRoot = config?.components?.componentRoot ?? '@/components';
  if (ctx.componentImports.size > 0) {
    const uiImports = [...ctx.componentImports].filter(c => ['Icon', 'Button'].includes(c));
    const others = [...ctx.componentImports].filter(c => !['Icon', 'Button'].includes(c));
    if (uiImports.length > 0) code.push(`import { ${uiImports.join(', ')} } from '${uiLib}';`);
    for (const imp of others) code.push(`import { ${imp} } from '${compRoot}/${imp}';`);
  }

  if (code.length > 0 && code[code.length - 1] !== '') code.push('');

  // Metadata export (server components only)
  if (ctx.metadata && !ctx.isClient) {
    code.push(`import type { Metadata } from 'next';`);
    code.push('');
    code.push(`export const metadata: Metadata = {`);
    for (const [k, v] of Object.entries(ctx.metadata)) {
      code.push(`  ${k}: '${escapeJsx(v)}',`);
    }
    code.push(`};`);
    code.push('');
  }

  // Component
  if (isLayout) {
    code.push(`export default function ${name}({ children }: { children: React.ReactNode }) {`);
  } else if (isError) {
    code.push(`export default function ${name}({ error, reset }: { error: Error; reset: () => void }) {`);
  } else {
    code.push(`export default function ${name}() {`);
  }
  code.push('  return (');
  code.push(...ctx.lines);
  code.push('  );');
  code.push('}');

  const output = code.join('\n');
  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(output);
  const tokenReduction = Math.round((1 - irTokenCount / tsTokenCount) * 100);

  // Determine output filename convention
  const files: NextFile[] = [];
  if (isLayout) files.push({ path: 'layout.tsx', content: output });
  else if (isLoading) files.push({ path: 'loading.tsx', content: output });
  else if (isError) files.push({ path: 'error.tsx', content: output });
  else files.push({ path: 'page.tsx', content: output });

  return {
    code: output,
    sourceMap: ctx.sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    files,
  };
}

