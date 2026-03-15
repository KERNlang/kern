/**
 * Kern v2 Specification
 *
 * The LLM-native language. Swiss-engineered.
 * Designed by 3 AIs through forge + tribunal + brainstorm.
 *
 * Foundation: indent-based, semantic names, key=value props
 * Styles: shorthand blocks in {} with CSS escape hatch
 * Meta: theme nodes ($ref), pseudo-selectors (:press, :hover)
 * Targets: Next.js, React+Tailwind, React Native
 */

export const KERN_VERSION = '2.0.0';

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
  'screen', 'row', 'col', 'card', 'scroll',
  // Content
  'text', 'image', 'progress', 'divider',
  // Interactive
  'button', 'input', 'modal',
  // Lists
  'list', 'item',
  // Navigation
  'tabs', 'tab', 'header',
  // Meta
  'theme',
] as const;

export type IRNodeType = (typeof NODE_TYPES)[number];

// ── Style Shorthands (FROZEN at v1.0 — 30 entries) ──────────────────────
// Any CSS property not in this map uses the escape hatch: "property":"value"
// This map will NOT grow. Use quoted keys for new CSS properties.
export const STYLE_SHORTHANDS: Record<string, string> = {
  // Spacing
  p: 'padding', m: 'margin',
  pt: 'paddingTop', pb: 'paddingBottom', pl: 'paddingLeft', pr: 'paddingRight',
  mt: 'marginTop', mb: 'marginBottom', ml: 'marginLeft', mr: 'marginRight',
  // Sizing
  w: 'width', h: 'height', f: 'flex',
  // Colors
  bg: 'backgroundColor', c: 'color', bc: 'borderColor',
  // Typography
  fs: 'fontSize', fw: 'fontWeight', ta: 'textAlign',
  // Borders
  br: 'borderRadius', bw: 'borderWidth',
  // Layout
  jc: 'justifyContent', ai: 'alignItems', fd: 'flexDirection',
  // Effects
  shadow: 'elevation',
};

// ── Justify/Align Value Shorthands ──────────────────────────────────────
export const VALUE_SHORTHANDS: Record<string, string> = {
  sb: 'space-between', sa: 'space-around', se: 'space-evenly',
  center: 'center', start: 'flex-start', end: 'flex-end',
  stretch: 'stretch', bold: 'bold',
  full: '100%',
};
