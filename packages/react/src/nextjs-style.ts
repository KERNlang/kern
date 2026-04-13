import type { IRNode } from '@kernlang/core';
import { applyTailwindTokenRules, getStyles, stylesToTailwind } from '@kernlang/core';
import type { Ctx } from './nextjs-types.js';

export function twClasses(node: IRNode, ctx: Ctx, extra: string = ''): string {
  const rawStyles = getStyles(node);
  // Expand semicolon-separated values that the parser merged into one entry
  const styles: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawStyles)) {
    if (v.includes(';')) {
      const segs = v
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      styles[k] = segs[0];
      for (let i = 1; i < segs.length; i++) {
        const ci = segs[i].indexOf(':');
        if (ci > 0) styles[segs[i].slice(0, ci).trim()] = segs[i].slice(ci + 1).trim();
      }
    } else {
      styles[k] = v;
    }
  }
  // Extract className pass-through (e.g. {className:doc.page} -> className={doc.page})
  const classNameRef = styles.className;
  const inlineStyles: Record<string, string> = {};
  const filteredStyles: Record<string, string> = {};
  for (const [k, v] of Object.entries(styles)) {
    if (k === 'className') continue;
    // Vendor-prefixed properties, CSS custom properties, and complex values -> inline style
    if (
      k.startsWith('-') ||
      v.includes('var(') ||
      k === 'borderBottom' ||
      k === 'background' ||
      k === 'color' ||
      k === 'fontFamily'
    ) {
      inlineStyles[k] = v;
    } else {
      filteredStyles[k] = v;
    }
  }
  let tw = stylesToTailwind(filteredStyles, ctx.colors);
  if (ctx.twProfile) tw = applyTailwindTokenRules(tw, ctx.twProfile);
  const parts = [tw, extra].filter(Boolean);
  const attrs: string[] = [];
  if (classNameRef) {
    // Detect if className is a JS expression (contains . or [) vs a plain CSS class string
    const isExprVal = /[.[\](]/.test(classNameRef);
    if (isExprVal) {
      if (parts.length > 0) {
        attrs.push(` className={\`\${${classNameRef}} ${parts.join(' ')}\`}`);
      } else {
        attrs.push(` className={${classNameRef}}`);
      }
    } else {
      // Plain CSS class name(s) -- quote them
      if (parts.length > 0) {
        attrs.push(` className="${classNameRef} ${parts.join(' ')}"`);
      } else {
        attrs.push(` className="${classNameRef}"`);
      }
    }
  } else if (parts.length > 0) {
    attrs.push(` className="${parts.join(' ')}"`);
  }
  if (Object.keys(inlineStyles).length > 0) {
    const pairs = Object.entries(inlineStyles).map(([k, v]) => {
      let jsKey: string;
      if (k.startsWith('-')) {
        // Vendor prefix: -webkit-background-clip -> WebkitBackgroundClip
        jsKey = k
          .slice(1)
          .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
          .replace(/^[a-z]/, (c) => c.toUpperCase());
      } else {
        jsKey = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      }
      return `${jsKey}: '${v}'`;
    });
    attrs.push(` style={{ ${pairs.join(', ')} }}`);
  }
  return attrs.join('');
}

// ── Route path helper ────────────────────────────────────────────────────

export function routeToPath(route: string, segment?: string): string {
  // Normalize: strip leading/trailing slashes
  const normalized = route.replace(/^\/+|\/+$/g, '');
  const parts = normalized ? normalized.split('/') : [];
  if (segment) parts.push(segment);
  return parts.length > 0 ? `${parts.join('/')}/` : '';
}

/** Convert raw HTML-style SVG attributes to JSX-safe syntax. */
export function htmlAttrsToJsx(html: string): string {
  // Convert unquoted numeric attrs: width=52 -> width={52}
  // Convert unquoted string attrs: fill=#E63946 -> fill="#E63946"
  return html.replace(/(\w+)=([^\s"'{/>]+)/g, (_match, key: string, val: string) => {
    if (/^[\d.]+$/.test(val)) return `${key}={${val}}`;
    return `${key}="${val}"`;
  });
}

export const SVG_ICONS: Record<string, string> = {
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

export const TEXT_TAG_MAP: Record<string, string> = {
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
