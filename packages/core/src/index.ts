/**
 * @kernlang/core — parser, types, spec, config, style engines, codegen
 */

// Runtime (instance-based state)
export { KernRuntime, defaultRuntime } from './runtime.js';
export type { ParserHintsConfig } from './runtime.js';

// Core
export { parse, parseDocument, parseWithDiagnostics, parseDocumentWithDiagnostics, parseStrict, parseDocumentStrict, getParseDiagnostics, getParseWarnings, registerParserHints, unregisterParserHints, clearParserHints, tokenizeLine } from './parser.js';
export type { Token, TokenKind } from './parser.js';
export { decompile } from './decompiler.js';
export { KernParseError, KernConfigError } from './errors.js';

// Types
export type {
  ExprObject,
  IRNode,
  IRSourceLocation,
  SourceMapEntry,
  TranspileResult,
  TranspileDiagnostic,
  DiagnosticOutcome,
  DecompileResult,
  GeneratedArtifact,
  KernEngine,
  ParseDiagnostic,
  ParseDiagnosticSeverity,
  ParseErrorCode,
  ParseResult,
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

// Schema validation
export { validateSchema, NODE_SCHEMAS } from './schema.js';
export type { NodeSchema, PropSchema, PropKind, SchemaViolation } from './schema.js';

// Style engines
export { stylesToTailwind, colorToTw, pxToTw, DEFAULT_COLORS } from './styles-tailwind.js';
export { expandStyles, expandStyleKey, expandStyleValue } from './styles-react.js';

// Codegen — public entry points
export {
  generateCoreNode, isCoreNode, CORE_NODE_TYPES,
  generateMachineReducer,
  // Safe emitters (prompt-injection immunity)
  emitIdentifier, emitStringLiteral, emitPath, emitTemplateSafe, emitTypeAnnotation, emitImportSpecifier,
  // Shared IR node helpers (used by transpiler packages)
  getProps, getChildren, getFirstChild, getStyles, getPseudoStyles, getThemeRefs,
  dedent, cssPropertyName, handlerCode, exportPrefix,
  parseParamList, capitalize,
  emitReasonAnnotations, emitLowConfidenceTodo,
  // Evolved generators — prefer KernRuntime for new code
  registerEvolvedGenerator, registerEvolvedTargetGenerator, unregisterEvolvedGenerator, clearEvolvedGenerators, hasEvolvedGenerator,
  mapSemanticType, SEMANTIC_TYPE_MAP,
} from './codegen-core.js';
export type { SemanticTypeMapping } from './codegen-core.js';

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
  EntrypointPayload, EffectPayload, StateMutationPayload, FunctionDeclarationPayload,
  ErrorRaisePayload, ErrorHandlePayload, GuardPayload,
  CallPayload, DependencyPayload,
} from './concepts.js';

// Utilities
export { countTokens, serializeIR, camelKey, escapeJsx, escapeJsxText, escapeJsxAttr, escapeJsString, buildDiagnostics, accountNode } from './utils.js';
export type { AccountedEntry } from './utils.js';

// Walker
export { walkIR, getNodeAtPosition } from './walk.js';
export type { WalkContext, VisitorFn, Visitor, VisitorMap } from './walk.js';

// Typed node props
export { propsOf, propsUntyped } from './node-props.js';
export type {
  NodePropsMap,
  TypeProps, InterfaceProps, UnionProps, ServiceProps, ConstProps,
  FnProps, ErrorProps, MachineProps,
  ConfigProps, StoreProps, RepositoryProps, CacheProps, DependencyProps, ModelProps,
  EventProps, OnProps, WebSocketProps,
  DeriveProps, TransformProps, ActionProps, GuardProps, AssumeProps, InvariantProps,
  EachProps, CollectProps, BranchProps, ResolveProps, ExpectProps, RecoverProps, PatternProps,
  ConditionalProps, SelectProps,
  ModuleProps, ImportProps, FieldProps, VariantProps, MethodProps,
  TransitionProps, StateProps, ColumnProps, RelationProps, OptionProps, TestProps,
} from './node-props.js';

// Source map serialization
export { serializeSourceMap } from './source-map.js';
export type { SourceMapV3 } from './source-map.js';
