/**
 * Kern v2 Specification
 *
 * The LLM-native language. Swiss-engineered.
 * Designed by 3 AIs through forge + tribunal + brainstorm.
 *
 * Foundation: indent-based, semantic names, key=value props
 * Styles: shorthand blocks in {} with CSS escape hatch
 * Meta: theme nodes ($ref), pseudo-selectors (:press, :hover)
 * Targets: Next.js, React+Tailwind, React Native, Express
 */

export const KERN_VERSION = '3.3.5';

// ── Grammar ─────────────────────────────────────────────────────────────
export const IR_GRAMMAR = `
document   = node+
node       = indent type (SP prop)* (SP style)? (SP themeref)* NL child*
child      = node
indent     = "  "*
type       = ident
prop       = ident "=" value
value      = quoted | bare
quoted     = '"' [^"]* '"'
bare       = [^\\s{$]+
style      = "{" spair ("," spair)* "}"
spair      = sident ":" svalue | ":" pseudo ":" sident ":" svalue
pseudo     = "press" | "hover" | "active" | "focus"
sident     = shorthand | ident
svalue     = [^,}]+
themeref   = "$" ident
ident      = [A-Za-z_][A-Za-z0-9_-]*
SP         = " "+
NL         = "\\n" | EOF
`;

// ── Node Types ──────────────────────────────────────────────────────────
export const NODE_TYPES = [
  // Layout
  'screen',
  'page',
  'row',
  'col',
  'card',
  'grid',
  'scroll',
  // Content
  'text',
  'image',
  'progress',
  'divider',
  'codeblock',
  // Structural
  'section',
  'form',
  // Interactive
  'button',
  'input',
  'textarea',
  'slider',
  'toggle',
  'modal',
  // Lists
  'list',
  'item',
  // Navigation
  'tabs',
  'tab',
  'header',
  'link',
  // Meta
  'theme',
  'doc',
  // Backend
  'server',
  'route',
  'middleware',
  'handler',
  'schema',
  'stream',
  'spawn',
  'timer',
  'on',
  'env',
  'websocket',
  // Route children (v3 — framework-agnostic route syntax)
  'params',
  'auth',
  'validate',
  'respond',
  'trigger',
  // CLI
  'cli',
  'command',
  'arg',
  'flag',
  'import',
  // Terminal
  'separator',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'scoreboard',
  'metric',
  'spinner',
  'box',
  'gradient',
  'state',
  'animation',
  'repl',
  'guard',
  'parallel',
  'dispatch',
  'then',
  'each',
  'let',
  // Next.js App Router
  'layout',
  'loading',
  // Next.js production patterns
  'metadata',
  'generateMetadata',
  'notFound',
  'redirect',
  'fetch',
  // Core Language — type system, functions, state machines
  'type',
  'interface',
  'field',
  'fn',
  'const',
  'union',
  'variant',
  'service',
  'class',
  'method',
  'getter',
  'setter',
  'singleton',
  'constructor',
  'signal',
  'cleanup',
  'machine',
  'transition',
  'error',
  'module',
  'export',
  'config',
  'store',
  'test',
  'describe',
  'it',
  'event',
  // React — hooks, providers, effects
  'hook',
  'provider',
  'effect',
  'logic',
  'memo',
  'callback',
  'ref',
  'context',
  'prop',
  'returns',
  'render',
  // Ink — terminal React (Ink) specific nodes
  'input-area',
  'output-area',
  'text-input',
  'select-input',
  'multi-select',
  'confirm-input',
  'password-input',
  'status-message',
  'alert',
  'ordered-list',
  'unordered-list',
  'focus',
  'app-exit',
  'static-log',
  'newline',
  'layout-row',
  'layout-col',
  'layout-stack',
  'spacer',
  'screen-embed',
  'alternate-screen',
  'scroll-box',
  // Backend data layer
  'model',
  'column',
  'relation',
  'repository',
  'dependency',
  'inject',
  'cache',
  'entry',
  'invalidate',
  // UI controls
  'conditional',
  'else',
  'elseif',
  'component',
  'select',
  'option',
  // Graphics
  'icon',
  'svg',
  // Template system
  'template',
  'slot',
  'body',
  // Ground layer — semantic reasoning
  'derive',
  'fmt',
  'set',
  'async',
  'transform',
  'action',
  'actionRegistry',
  'assume',
  'invariant',
  'branch',
  'path',
  'resolve',
  'candidate',
  'discriminator',
  'collect',
  'pattern',
  'apply',
  'expect',
  'recover',
  'strategy',
  // Reason layer — metadata children
  'reason',
  'evidence',
  // Confidence layer — evidence gaps
  'needs',
  // Rule layer — native .kern lint rules
  'rule',
  'message',
  // MCP — Model Context Protocol server definitions
  'mcp',
  'tool',
  'resource',
  'prompt',
  'param',
  'description',
  'sampling',
  'elicitation',
] as const;

export type IRNodeType = (typeof NODE_TYPES)[number];

// ── Dynamic Node Types (Evolve v4 — graduated nodes) ────────────────────
// Evolved nodes register here at startup. Checked by parser alongside NODE_TYPES.

import { defaultRuntime, type KernRuntime } from './runtime.js';

/** Register an evolved node type (called at startup from .kern/evolved/). */
export function registerEvolvedType(keyword: string): void {
  defaultRuntime.registerEvolvedType(keyword);
}

/** Unregister an evolved node type (for rollback/testing). */
export function unregisterEvolvedType(keyword: string): void {
  defaultRuntime.unregisterEvolvedType(keyword);
}

/** Check if a type is a known node type (core or evolved). */
export function isKnownNodeType(type: string, runtime?: KernRuntime): boolean {
  const rt = runtime ?? defaultRuntime;
  return (NODE_TYPES as readonly string[]).includes(type) || rt.dynamicNodeTypes.has(type);
}

/** Get all dynamically registered evolved types (defensive copy). */
export function getEvolvedTypes(): ReadonlySet<string> {
  return defaultRuntime.getEvolvedTypes();
}

/** Clear all dynamic types (for test isolation). */
export function clearEvolvedTypes(): void {
  defaultRuntime.clearEvolvedTypes();
}

/** Reserved keywords — evolved nodes cannot use these. */
export const KERN_RESERVED: ReadonlySet<string> = Object.freeze(new Set(NODE_TYPES));

// ── Style Shorthands (FROZEN at v1.0 — 30 entries) ──────────────────────
// Any CSS property not in this map uses the escape hatch: "property":"value"
// This map will NOT grow. Use quoted keys for new CSS properties.
export const STYLE_SHORTHANDS: Record<string, string> = {
  // Spacing
  p: 'padding',
  m: 'margin',
  px: 'paddingX',
  py: 'paddingY',
  pt: 'paddingTop',
  pb: 'paddingBottom',
  pl: 'paddingLeft',
  pr: 'paddingRight',
  mx: 'marginX',
  my: 'marginY',
  mt: 'marginTop',
  mb: 'marginBottom',
  ml: 'marginLeft',
  mr: 'marginRight',
  // Sizing
  w: 'width',
  h: 'height',
  f: 'flex',
  'max-width': 'maxWidth',
  'min-width': 'minWidth',
  'max-height': 'maxHeight',
  'min-height': 'minHeight',
  // Positioning
  'z-index': 'zIndex',
  // Colors
  bg: 'backgroundColor',
  c: 'color',
  bc: 'borderColor',
  // Typography
  fs: 'fontSize',
  fw: 'fontWeight',
  ta: 'textAlign',
  // Borders
  br: 'borderRadius',
  bw: 'borderWidth',
  // Layout
  jc: 'justifyContent',
  ai: 'alignItems',
  fd: 'flexDirection',
  // Effects
  shadow: 'elevation',
};

// ── Justify/Align Value Shorthands ──────────────────────────────────────
export const VALUE_SHORTHANDS: Record<string, string> = {
  sb: 'space-between',
  sa: 'space-around',
  se: 'space-evenly',
  center: 'center',
  start: 'flex-start',
  end: 'flex-end',
  stretch: 'stretch',
  bold: 'bold',
  full: '100%',
};
