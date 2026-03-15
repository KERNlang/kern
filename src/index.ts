/**
 * Kern — the LLM-native language.
 *
 * Swiss-engineered IR that transpiles to React, Next.js, Express,
 * Tailwind, and React Native.
 */

// Core
export { parse } from './parser.js';
export { decompile } from './decompiler.js';

// Types
export type {
  IRNode,
  IRSourceLocation,
  SourceMapEntry,
  TranspileResult,
  DecompileResult,
  GeneratedArtifact,
  KernEngine,
} from './types.js';

// Config
export { resolveConfig, mergeConfig, DEFAULT_CONFIG, VALID_TARGETS } from './config.js';
export type { KernConfig, KernTarget, ResolvedKernConfig } from './config.js';

// Transpilers
export { transpile } from './transpiler.js';
export { transpileWeb } from './transpiler-web.js';
export { transpileTailwind } from './transpiler-tailwind.js';
export { transpileNextjs } from './transpiler-nextjs.js';
export { transpileExpress } from './transpiler-express.js';

// Metrics
export { collectLanguageMetrics, mergeMetrics, isEscapedStyleKey } from './metrics.js';
export type { LanguageMetrics, StyleMetrics, NodeTypeMetrics } from './metrics.js';

// Context export (for Agon integration)
export { scanKernProject, projectToKern } from './context-export.js';
export type { ProjectSummary } from './context-export.js';

// Draft protocol (for Agon forge/brainstorm/tribunal)
export { buildKernDraftPrompt, parseKernDraft, buildKernRankPrompt } from './draft-protocol.js';
export type { KernDraft } from './draft-protocol.js';

// Spec
export { KERN_VERSION, NODE_TYPES, STYLE_SHORTHANDS, VALUE_SHORTHANDS } from './spec.js';

// Shared style engines
export { stylesToTailwind, colorToTw, pxToTw, DEFAULT_COLORS } from './styles-tailwind.js';
export { expandStyles, expandStyleKey, expandStyleValue } from './styles-react.js';

// Utilities
export { countTokens, serializeIR, camelKey, escapeJsx } from './utils.js';
