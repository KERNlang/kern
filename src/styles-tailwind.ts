import { STYLE_SHORTHANDS, VALUE_SHORTHANDS } from './spec.js';

// ── Default color palette (canonical source of truth) ────────────────────

export const DEFAULT_COLORS: Record<string, string> = {
  '#18181b': 'zinc-900',
  '#27272a': 'zinc-800',
  '#3f3f46': 'zinc-700',
  '#52525b': 'zinc-600',
  '#71717a': 'zinc-500',
  '#a1a1aa': 'zinc-400',
  '#d4d4d8': 'zinc-300',
  '#e4e4e7': 'zinc-200',
  '#f4f4f5': 'zinc-100',
  '#fafafa': 'zinc-50',
  '#09090b': 'zinc-950',
  '#ffffff': 'white',
  '#fff': 'white',
  '#FFF': 'white',
  '#f97316': 'orange-500',
  '#ea580c': 'orange-600',
  '#F8F9FA': 'gray-50',
};

// ── Style-to-Tailwind mapping ───────────────────────────────────────────

export function stylesToTailwind(styles: Record<string, string>, colors?: Record<string, string>): string {
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
      case 'backgroundColor': classes.push(colorToTw('bg', v, colors)); break;
      case 'color': classes.push(colorToTw('text', v, colors)); break;
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
      case 'borderColor': classes.push(colorToTw('border', v, colors)); break;
      case 'borderWidth': classes.push('border'); break;
      case 'overflow': classes.push(`overflow-${v}`); break;
      case 'textAlign': classes.push(`text-${v}`); break;
      case 'elevation': classes.push(`shadow-${v === '0' ? 'none' : v}`); break;
      case 'opacity': classes.push(`opacity-${Math.round(Number(v) * 100) || v}`); break;
      case 'position': classes.push(v); break;
      case 'display': classes.push(v === 'none' ? 'hidden' : v); break;
      case 'zIndex': classes.push(`z-${v}`); break;
      default:
        // Pass through as arbitrary Tailwind property
        const twVal = v.replace(/ /g, '_');
        classes.push(`[${cssKebab(expanded)}:${twVal}]`);
    }
  }

  return classes.join(' ');
}

export function pxToTw(prefix: string, v: string): string {
  const n = Number(v);
  if (isNaN(n)) return `${prefix}-[${v}]`;

  // Special handling for border-radius → Tailwind rounded classes
  if (prefix === 'rounded') {
    const roundedMap: Record<number, string> = {
      0: 'rounded-none', 2: 'rounded-sm', 4: 'rounded', 6: 'rounded-md',
      8: 'rounded-lg', 12: 'rounded-xl', 16: 'rounded-2xl', 20: 'rounded-[20px]',
      9999: 'rounded-full',
    };
    return roundedMap[n] || `rounded-[${n}px]`;
  }

  // Tailwind spacing scale: 1=4px, 2=8px, 3=12px, 4=16px, 5=20px, 6=24px, 8=32px
  const twMap: Record<number, string> = {
    0: '0', 1: 'px', 2: '0.5', 4: '1', 6: '1.5', 8: '2', 10: '2.5',
    12: '3', 14: '3.5', 16: '4', 20: '5', 24: '6', 28: '7', 32: '8',
    36: '9', 40: '10', 44: '11', 48: '12',
  };
  return twMap[n] !== undefined ? `${prefix}-${twMap[n]}` : `${prefix}-[${n}px]`;
}

export function colorToTw(prefix: string, v: string, colors?: Record<string, string>): string {
  const colorMap = colors ?? DEFAULT_COLORS;
  const mapped = colorMap[v];
  return mapped ? `${prefix}-${mapped}` : `${prefix}-[${v}]`;
}

export function fsTw(v: string): string {
  const map: Record<string, string> = {
    '10': 'text-[10px]', '11': 'text-[11px]', '12': 'text-xs', '13': 'text-[13px]',
    '14': 'text-sm', '16': 'text-base', '18': 'text-lg', '20': 'text-xl',
    '24': 'text-2xl', '28': 'text-[28px]', '30': 'text-3xl',
  };
  return map[v] || `text-[${v}px]`;
}

export function fwTw(v: string): string {
  const map: Record<string, string> = {
    '300': 'font-light', '400': 'font-normal', '500': 'font-medium',
    '600': 'font-semibold', '700': 'font-bold', '800': 'font-extrabold',
    '900': 'font-black', 'bold': 'font-bold', 'normal': 'font-normal',
    'medium': 'font-medium', 'semibold': 'font-semibold',
  };
  return map[v] || `font-[${v}]`;
}

export function addPx(v: string): string {
  const n = Number(v);
  return isNaN(n) ? v : `${n}px`;
}

export function cssKebab(s: string): string {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}
