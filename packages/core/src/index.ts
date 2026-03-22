/**
 * @kernlang/core — parser, types, spec, config, style engines, codegen
 */

// Core
export { parse, registerParserHints, unregisterParserHints, clearParserHints, tokenizeLine } from './parser.js';
export type { Token, TokenKind } from './parser.js';
export { decompile } from './decompiler.js';
export { KernParseError } from './errors.js';

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
export { resolveConfig, mergeConfig, DEFAULT_CONFIG, VALID_TARGETS, VALID_STRUCTURES } from './config.js';
export type { KernConfig, KernTarget, KernStructure, ResolvedKernConfig, FrameworkVersions, ExpressSecurityLevel } from './config.js';

// Version detection & adapters
export { parseMajorVersion, detectVersionsFromPackageJson, resolveTailwindMajor, resolveNextjsMajor } from './version-detect.js';
export {
  buildTailwindProfile, buildNextjsProfile, buildVersionProfile,
  applyTailwindTokenRules,
} from './version-adapters.js';
export type {
  TailwindTokenRule, TailwindOutputRules, TailwindVersionProfile,
  NextjsOutputRules, NextjsVersionProfile, VersionProfile,
} from './version-adapters.js';

// Spec
export {
  KERN_VERSION, NODE_TYPES, STYLE_SHORTHANDS, VALUE_SHORTHANDS,
  // Evolved types (v4)
  registerEvolvedType, unregisterEvolvedType, isKnownNodeType, getEvolvedTypes, clearEvolvedTypes, KERN_RESERVED,
} from './spec.js';

// Style engines
export { stylesToTailwind, colorToTw, pxToTw, DEFAULT_COLORS } from './styles-tailwind.js';
export { expandStyles, expandStyleKey, expandStyleValue } from './styles-react.js';

// Codegen core
export {
  generateCoreNode, isCoreNode, CORE_NODE_TYPES,
  generateType, generateInterface, generateUnion, generateService, generateFunction,
  generateMachine, generateMachineReducer, generateError, generateModule,
  generateConfig, generateStore, generateTest, generateEvent,
  generateImport, generateConst, generateHook,
  generateOn, generateWebSocket,
  // Ground layer
  generateDerive, generateTransform, generateAction, generateGuard,
  generateAssume, generateInvariant, generateEach, generateCollect,
  generateBranch, generateResolve, generateExpect, generateRecover,
  generatePattern, generateApply,
  emitReasonAnnotations, emitLowConfidenceTodo,
  parseParamList, capitalize,
  // Shared IR node helpers
  getProps, getChildren, getFirstChild, getStyles, getPseudoStyles, getThemeRefs,
  dedent, cssPropertyName, handlerCode,
  // Graduated nodes
  generateConditional, generateSelect,
  generateModel, generateRepository, generateDependency, generateCache,
  // Evolved generators (v4)
  registerEvolvedGenerator, registerEvolvedTargetGenerator, unregisterEvolvedGenerator, clearEvolvedGenerators, hasEvolvedGenerator,
} from './codegen-core.js';

// Codegen errors
export { KernCodegenError } from './errors.js';

// Template engine
export {
  registerTemplate, isTemplateNode, expandTemplateNode,
  clearTemplates, getTemplate, templateCount, KernTemplateError,
} from './template-engine.js';
export type { TemplateDefinition, TemplateSlot, TemplateImport, TemplateSlotType } from './types.js';

// Coverage gap emitter (v3)
export { collectCoverageGaps, writeCoverageGaps, readCoverageGaps } from './coverage-gap.js';
export type { CoverageGap } from './coverage-gap.js';

// Template catalog
export { TEMPLATE_CATALOG, COMMON_TEMPLATES, detectTemplates } from './template-catalog.js';
export type { CatalogEntry } from './template-catalog.js';

// Scanner
export { scanProject, generateConfigSource, formatScanSummary } from './scanner.js';
export type { ScanResult, ScanInfo, Detection } from './scanner.js';

// Concepts (universal cross-language review model)
export { conceptId, conceptSpan } from './concepts.js';
export type {
  ConceptNode, ConceptEdge, ConceptMap, ConceptSpan,
  ConceptNodeKind, ConceptEdgeKind,
  ConceptNodePayload, ConceptEdgePayload,
  EntrypointPayload, EffectPayload, StateMutationPayload,
  ErrorRaisePayload, ErrorHandlePayload, GuardPayload,
  CallPayload, DependencyPayload,
} from './concepts.js';

// Utilities
export { countTokens, serializeIR, camelKey, escapeJsx, escapeJsxText, escapeJsxAttr, escapeJsString } from './utils.js';
