import type { IRNode } from '@kernlang/core';
import { colorToTw, escapeJsxAttr, escapeJsxText, getProps, getStyles } from '@kernlang/core';
import { addDefaultImport, addNamedImport, exprCode, isExpr } from './nextjs-imports.js';
import { htmlAttrsToJsx, SVG_ICONS, TEXT_TAG_MAP, twClasses } from './nextjs-style.js';
import type { Ctx } from './nextjs-types.js';

// ── Node renderers ──────────────────────────────────────────────────────

export function renderNode(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  ctx.sourceMap.push({
    irLine: node.loc?.line || 0,
    irCol: node.loc?.col || 1,
    outLine: ctx.lines.length + 1,
    outCol: 1,
  });

  switch (node.type) {
    case 'page':
    case 'screen':
      renderPage(node, ctx, indent);
      break;
    case 'layout':
      renderLayout(node, ctx, indent);
      break;
    case 'loading':
      renderLoading(node, ctx, indent);
      break;
    case 'error':
      renderError(node, ctx, indent);
      break;
    case 'metadata':
      renderMetadata(node, ctx);
      break;
    case 'section':
      renderSection(node, ctx, indent);
      break;
    case 'card':
      renderCard(node, ctx, indent);
      break;
    case 'row':
      ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'flex')}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</div>`);
      break;
    case 'col':
      ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'flex flex-col')}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</div>`);
      break;
    case 'text':
      renderText(node, ctx, indent);
      break;
    case 'divider':
      ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'h-px')} />`);
      break;
    case 'button':
      renderButton(node, ctx, indent);
      break;
    case 'link':
      renderLink(node, ctx, indent);
      break;
    case 'image':
      renderImage(node, ctx, indent);
      break;
    case 'codeblock':
      renderCodeBlock(node, ctx, indent);
      break;
    case 'input':
    case 'textarea':
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
    case 'component':
      renderComponent(node, ctx, indent);
      break;
    case 'icon':
      ctx.componentImports.add('Icon');
      ctx.lines.push(`${indent}<Icon name="${p.name}" size="sm"${twClasses(node, ctx)} />`);
      break;
    case 'svg':
      renderSvg(node, ctx, indent);
      break;
    case 'form':
      ctx.lines.push(`${indent}<form${twClasses(node, ctx)}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</form>`);
      break;
    case 'list':
      ctx.lines.push(`${indent}<div${twClasses(node, ctx, 'space-y-2')}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</div>`);
      break;
    case 'item':
      ctx.lines.push(`${indent}<div${twClasses(node, ctx)}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</div>`);
      break;
    case 'progress':
      renderProgress(node, ctx, indent);
      break;
    case 'tabs':
      ctx.lines.push(`${indent}<nav${twClasses(node, ctx, 'flex')}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</nav>`);
      break;
    case 'tab':
      ctx.lines.push(`${indent}<button${twClasses(node, ctx)}>${escapeJsxText(String(p.label || ''))}</button>`);
      break;
    case 'table':
      ctx.lines.push(`${indent}<table${twClasses(node, ctx)}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</table>`);
      break;
    case 'thead':
      ctx.lines.push(`${indent}<thead>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</thead>`);
      break;
    case 'tbody':
      ctx.lines.push(`${indent}<tbody>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</tbody>`);
      break;
    case 'tr':
      ctx.lines.push(`${indent}<tr${twClasses(node, ctx)}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</tr>`);
      break;
    case 'th':
      renderTableCell(node, ctx, indent, 'th');
      break;
    case 'td':
      renderTableCell(node, ctx, indent, 'td');
      break;
    case 'generateMetadata':
      renderGenerateMetadata(node, ctx);
      break;
    case 'notFound':
      renderNotFound(node, ctx, indent);
      break;
    case 'redirect':
      renderRedirect(node, ctx, indent);
      break;
    case 'import':
      renderImport(node, ctx);
      break;
    case 'fetch':
      renderFetchNode(node, ctx);
      break;
    case 'on':
      renderOnHandler(node, ctx);
      return;
    case 'state':
      ctx.stateDecls.push({ name: String(p.name || ''), initial: String(p.initial ?? '') });
      ctx.isClient = true; // state requires 'use client'
      return;
    case 'logic':
      if (p.code) ctx.logicBlocks.push(String(p.code));
      else if (node.children) {
        const handlerChild = node.children.find((c) => c.type === 'handler');
        if (handlerChild?.props?.code) ctx.logicBlocks.push(String(handlerChild.props.code));
      }
      ctx.isClient = true;
      return;
    case 'theme':
      break;
    default:
      ctx.lines.push(`${indent}<div${twClasses(node, ctx)}>`);
      renderChildren(node, ctx, indent);
      ctx.lines.push(`${indent}</div>`);
  }
}

export function renderChildren(node: IRNode, ctx: Ctx, indent: string): void {
  if (node.children) for (const child of node.children) renderNode(child, ctx, `${indent}  `);
}

function renderPage(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  if (p.client === 'true' || p.client === true) ctx.isClient = true;
  if (p.async === 'true' || p.async === true) ctx.isAsync = true;

  // GAP-008: a `render` child on a page emits its body verbatim as the
  // return JSX, bypassing the default `<div>` wrapper. Two shapes are
  // accepted: the raw `render <<<jsx>>>` form (parser stores code on the
  // render node itself) and the structured `render / handler <<<jsx>>>`
  // form (code lives on a `handler` child). Sibling children on the page
  // (fetch/state/import/logic) still run first so they populate ctx.
  const children = node.children || [];
  const renderChild = children.find((c) => c.type === 'render');
  const renderInlineCode = renderChild?.props?.code ? String(renderChild.props.code) : undefined;
  const renderHandler = renderChild?.children?.find((c) => c.type === 'handler');
  const renderHandlerCode = renderHandler?.props?.code ? String(renderHandler.props.code) : undefined;
  const renderCode = renderInlineCode ?? renderHandlerCode;

  if (renderCode) {
    for (const child of children) {
      if (child.type !== 'render') renderNode(child, ctx, `${indent}  `);
    }
    for (const line of renderCode.split('\n')) {
      ctx.lines.push(`${indent}${line}`);
    }
    return;
  }

  ctx.lines.push(`${indent}<div${twClasses(node, ctx)}>`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderLayout(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  ctx.lines.push(`${indent}<html lang="${p.lang || 'en'}">`);
  ctx.lines.push(`${indent}  <body${twClasses(node, ctx)}>`);
  ctx.lines.push(`${indent}    {children}`);
  renderChildren(node, ctx, `${indent}  `);
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
  const title = (p.title as string) || '';
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
  const lang = (p.lang as string) || '';
  const langClass = lang ? ` language-${lang}` : '';
  const hasCustomStyle = getStyles(node).className || getStyles(node).background;
  const preAttrs = hasCustomStyle ? twClasses(node, ctx) : ` className="bg-zinc-900 rounded-lg p-4 overflow-x-auto"`;
  const codeClass = hasCustomStyle
    ? `className="${langClass.trim()}"` +
      (getStyles(node).fontFamily ? ` style={{ fontFamily: '${getStyles(node).fontFamily}' }}` : '')
    : `className="text-sm font-mono text-zinc-100${langClass}"`;
  // Content: inline value prop or body child node
  const rawValue = p.value;
  if (isExpr(rawValue)) {
    ctx.lines.push(`${indent}<pre${preAttrs}>`);
    ctx.lines.push(`${indent}  <code ${codeClass}>{${rawValue.code}}</code>`);
    ctx.lines.push(`${indent}</pre>`);
    return;
  }
  let content = (rawValue as string) || '';
  if (!content && node.children) {
    const bodyNode = node.children.find((c) => c.type === 'body');
    if (bodyNode) {
      const bp = getProps(bodyNode);
      // body value="..." OR body <<<...>>> (multiline block -> code prop)
      content = (bp.code as string) || (bp.value as string) || '';
    }
  }
  // Escape for JSX template literal: backslashes, backticks, ${
  const escaped = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  ctx.lines.push(`${indent}<pre${preAttrs}>`);
  ctx.lines.push(`${indent}  <code ${codeClass}>{\`${escaped}\`}</code>`);
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

function renderText(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const rawValue = p.value;
  const bind = p.bind as string;
  const el = TEXT_TAG_MAP[p.tag as string] || 'span';
  const tw = twClasses(node, ctx);
  if (isExpr(rawValue)) ctx.lines.push(`${indent}<${el}${tw}>{${rawValue.code}}</${el}>`);
  else if (bind) ctx.lines.push(`${indent}<${el}${tw}>{${bind}}</${el}>`);
  else if (rawValue) ctx.lines.push(`${indent}<${el}${tw}>${escapeJsxText(rawValue as string)}</${el}>`);
}

function renderButton(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const text = (p.text as string) || '';
  const to = p.to as string;
  const rawOnClick = p.onClick;
  const onClick = isExpr(rawOnClick) ? rawOnClick.code : (rawOnClick as string);
  if (to) {
    addDefaultImport(ctx, 'next/link', 'Link');
    ctx.lines.push(`${indent}<Link href="/${to.toLowerCase()}"${twClasses(node, ctx)}>${escapeJsxText(text)}</Link>`);
  } else {
    ctx.isClient = true; // onClick requires 'use client'
    ctx.lines.push(
      `${indent}<button${twClasses(node, ctx)} onClick={${onClick || '() => {}'}}>${escapeJsxText(text)}</button>`,
    );
  }
}

function renderInput(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const isTextarea = node.type === 'textarea' || p.type === 'textarea' || p.multiline;
  const tag = isTextarea ? 'textarea' : 'input';
  const attrs: string[] = [];
  const tw = twClasses(node, ctx);
  if (p.bind) {
    const bind = p.bind as string;
    const setter = `set${bind.charAt(0).toUpperCase() + bind.slice(1)}`;
    attrs.push(`value={${bind}}`);
    ctx.isClient = true; // onChange requires 'use client'
    if (isExpr(p.onChange)) attrs.push(`onChange={${p.onChange.code}}`);
    else if (p.onChange) attrs.push(`onChange={${p.onChange}}`);
    else attrs.push(`onChange={(e) => ${setter}(e.target.value)}`);
  }
  if (p.placeholder) attrs.push(`placeholder="${p.placeholder}"`);
  if (!isTextarea && p.type && p.type !== 'textarea') attrs.push(`type="${p.type}"`);
  if (p.spellcheck === 'false' || p.spellcheck === false) attrs.push('spellCheck={false}');
  const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  if (isTextarea) {
    ctx.lines.push(`${indent}<${tag}${tw}${attrStr} rows={4} />`);
  } else {
    ctx.lines.push(`${indent}<${tag}${tw}${attrStr} />`);
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
  const rawSrc = (p.src as string) || '';
  const src = rawSrc.startsWith('/') || rawSrc.includes('://') || rawSrc.includes('.') ? rawSrc : `/${rawSrc}.png`;
  const alt = escapeJsxAttr(String(p.alt || p.src || ''));
  const fill = p.fill === 'true' || p.fill === true;
  const priority = p.priority === 'true' || p.priority === true;
  if (fill) {
    ctx.lines.push(`${indent}<Image src="${src}" alt="${alt}"${priority ? ' priority' : ''} fill${tw} />`);
  } else {
    const width = p.width || getStyles(node).w || '100';
    const height = p.height || getStyles(node).h || '100';
    ctx.lines.push(
      `${indent}<Image src="${src}" alt="${alt}" width={${width}} height={${height}}${priority ? ' priority' : ''}${tw} />`,
    );
  }
}

function renderSlider(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const bind = p.bind as string;
  const setter = bind ? `set${bind.charAt(0).toUpperCase() + bind.slice(1)}` : 'setValue';
  ctx.isClient = true; // onChange requires 'use client'
  ctx.lines.push(
    `${indent}<input type="range" min={${p.min || 0}} max={${p.max || 100}} step={${p.step || 1}} value={${bind || 'value'}} onChange={(e) => ${setter}(parseFloat(e.target.value))} className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-orange-500" />`,
  );
}

function renderToggle(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const bind = p.bind as string;
  const setter = bind ? `set${bind.charAt(0).toUpperCase() + bind.slice(1)}` : 'setValue';
  ctx.isClient = true; // onChange requires 'use client'
  ctx.lines.push(`${indent}<label className="relative inline-flex items-center cursor-pointer">`);
  ctx.lines.push(
    `${indent}  <input type="checkbox" className="sr-only peer" checked={${bind || 'value'}} onChange={(e) => ${setter}(e.target.checked)} />`,
  );
  ctx.lines.push(
    `${indent}  <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600" />`,
  );
  ctx.lines.push(`${indent}</label>`);
}

function renderOnHandler(node: IRNode, ctx: Ctx): void {
  const p = getProps(node);
  const event = (p.event || p.name) as string;
  const handlerRef = p.handler as string;
  const key = p.key as string;
  const isAsync = p.async === 'true' || p.async === true;

  const handlerChild = (node.children || []).find((c) => c.type === 'handler');
  const code = handlerChild ? (getProps(handlerChild).code as string) || '' : '';

  if (handlerRef && !code) return;

  ctx.isClient = true; // event handlers require 'use client'
  const fnName = handlerRef || `handle${event.charAt(0).toUpperCase() + event.slice(1)}`;
  const asyncKw = isAsync ? 'async ' : '';

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
              : event === 'scroll'
                ? 'e: React.UIEvent'
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

function renderTableCell(node: IRNode, ctx: Ctx, indent: string, tag: 'th' | 'td'): void {
  const p = getProps(node);
  const tw = twClasses(node, ctx);
  const rawValue = p.value;
  if (isExpr(rawValue)) {
    ctx.lines.push(`${indent}<${tag}${tw}>{${rawValue.code}}</${tag}>`);
  } else if (rawValue) {
    ctx.lines.push(`${indent}<${tag}${tw}>${escapeJsxText(rawValue as string)}</${tag}>`);
  } else if (node.children && node.children.length > 0) {
    ctx.lines.push(`${indent}<${tag}${tw}>`);
    renderChildren(node, ctx, indent);
    ctx.lines.push(`${indent}</${tag}>`);
  } else {
    ctx.lines.push(`${indent}<${tag}${tw} />`);
  }
}

function renderGrid(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const cols = parseInt(String(p.cols || 1), 10) || 1;
  const gap = parseInt(String(p.gap || 16), 10) || 16;
  ctx.lines.push(`${indent}<div className="grid grid-cols-1 md:grid-cols-${cols} gap-${Math.round(gap / 4)}">`);
  renderChildren(node, ctx, indent);
  ctx.lines.push(`${indent}</div>`);
}

function renderSvg(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const icon = p.icon as string;
  const size = parseInt(String(p.size || 24), 10) || 24;

  if (icon) {
    const inner = SVG_ICONS[icon] || `<circle cx="12" cy="12" r="4"/>`;
    ctx.lines.push(
      `${indent}<svg xmlns="http://www.w3.org/2000/svg" width={${size}} height={${size}} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"${twClasses(node, ctx)}>${inner}</svg>`,
    );
  } else {
    // Custom SVG -- only emit attributes the user explicitly set (no Feather defaults)
    const viewBox = (p.viewBox as string) || '0 0 24 24';
    const width = parseInt(String(p.width || size), 10) || size;
    const height = parseInt(String(p.height || size), 10) || size;
    const content = htmlAttrsToJsx((p.content as string) || '');
    const optAttrs: string[] = [];
    if (p.fill) optAttrs.push(`fill="${p.fill}"`);
    if (p.stroke) optAttrs.push(`stroke="${p.stroke}"`);
    const extra = optAttrs.length ? ` ${optAttrs.join(' ')}` : '';
    ctx.lines.push(
      `${indent}<svg xmlns="http://www.w3.org/2000/svg" width={${width}} height={${height}} viewBox="${viewBox}"${extra}${twClasses(node, ctx)}>${content}</svg>`,
    );
  }
}

function renderConditional(node: IRNode, ctx: Ctx, indent: string): void {
  const cond = ((getProps(node).if as string) || 'true')
    .replace(/&/g, ' && ')
    .replace(/([a-zA-Z_]+)=([a-zA-Z_]+)/g, "$1 === '$2'");
  ctx.lines.push(`${indent}{${cond} && (`);
  ctx.lines.push(`${indent}  <>`);
  renderChildren(node, ctx, `${indent}  `);
  ctx.lines.push(`${indent}  </>`);
  ctx.lines.push(`${indent})}`);
}

function renderComponent(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const ref = (p.ref || p.name) as string;
  if (!ref) return;
  ctx.componentImports.add(ref);
  const hasOnChange = 'onChange' in p;
  const attrs: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (['ref', 'name', 'styles', 'pseudoStyles', 'themeRefs'].includes(k)) continue;
    if (k === 'bind') {
      attrs.push(`value={${v}}`);
      if (!hasOnChange) attrs.push(`onChange={set${(v as string).charAt(0).toUpperCase() + (v as string).slice(1)}}`);
    } else if (k === 'onChange') attrs.push(`onChange={${v}}`);
    else if (k === 'props') {
      for (const pn of (v as string).split(',')) attrs.push(`${pn.trim()}={${pn.trim()}}`);
    } else if (k === 'disabled')
      attrs.push(
        `disabled={${(v as string).replace(/&/g, ' && ').replace(/([a-zA-Z_]+)=([a-zA-Z_]+)/g, "$1 === '$2'")}}`,
      );
    else if (k === 'default') attrs.push(`defaultValue={${JSON.stringify(v)}}`);
    else attrs.push(`${k}={${JSON.stringify(v)}}`);
  }
  const attrStr = attrs.length ? ` ${attrs.join(' ')}` : '';
  if (node.children && node.children.length > 0) {
    ctx.lines.push(`${indent}<${ref}${attrStr}>`);
    renderChildren(node, ctx, indent);
    ctx.lines.push(`${indent}</${ref}>`);
  } else {
    ctx.lines.push(`${indent}<${ref}${attrStr} />`);
  }
}

function renderProgress(node: IRNode, ctx: Ctx, indent: string): void {
  const p = getProps(node);
  const current = Number(p.current || 0),
    target = Number(p.target || 100);
  const pct = Math.round((current / target) * 100);
  ctx.lines.push(`${indent}<div className="mb-3">`);
  ctx.lines.push(
    `${indent}  <div className="flex justify-between text-sm mb-1"><span>${escapeJsxText(String(p.label || ''))}</span><span>${current}/${target} ${escapeJsxText(String(p.unit || ''))}</span></div>`,
  );
  ctx.lines.push(
    `${indent}  <div className="h-2 bg-zinc-700 rounded-full overflow-hidden"><div className="h-full rounded-full bg-[${p.color || '#007AFF'}]" style={{ width: '${pct}%' }} /></div>`,
  );
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
  const to = (p.to as string) || '/';
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
      // Support comma-separated named imports: name=Foo,Bar,Baz
      const names = name
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      for (const n of names) {
        addNamedImport(ctx, from, n);
      }
    }
  }
}

function renderFetchNode(node: IRNode, ctx: Ctx): void {
  const p = getProps(node);
  const name = (p.name as string) || 'data';
  const url = (p.url as string) || '/api/data';
  const options = p.options as string;
  const handlerChild = (node.children || []).find((c) => c.type === 'handler');
  const handlerCode = handlerChild?.props?.code ? String(handlerChild.props.code) : undefined;
  ctx.fetchCalls.push({ name, url, options, handlerCode });
}
