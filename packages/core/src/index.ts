/**
 * @kernlang/core — parser, types, spec, config, style engines, codegen
 */

export type { SemanticTypeMapping } from './codegen-core.js';
// Codegen — public entry points
export {
  CORE_NODE_TYPES,
  capitalize,
  clearEvolvedGenerators,
  cssPropertyName,
  dedent,
  // Safe emitters (prompt-injection immunity)
  emitIdentifier,
  emitImportSpecifier,
  emitLowConfidenceTodo,
  emitPath,
  emitReasonAnnotations,
  emitStringLiteral,
  emitTemplateSafe,
  emitTypeAnnotation,
  exportPrefix,
  generateCoreNode,
  generateMachineReducer,
  getChildren,
  getFirstChild,
  // Shared IR node helpers (used by transpiler packages)
  getProps,
  getPseudoStyles,
  getStyles,
  getThemeRefs,
  handlerCode,
  hasEvolvedGenerator,
  isCoreNode,
  mapSemanticType,
  parseParamList,
  // Evolved generators — prefer KernRuntime for new code
  registerEvolvedGenerator,
  registerEvolvedTargetGenerator,
  SEMANTIC_TYPE_MAP,
  sourceComment,
  unregisterEvolvedGenerator,
} from './codegen-core.js';
export type {
  CallPayload,
  ConceptEdge,
  ConceptEdgeKind,
  ConceptEdgePayload,
  ConceptMap,
  ConceptNode,
  ConceptNodeKind,
  ConceptNodePayload,
  ConceptSpan,
  DependencyPayload,
  EffectPayload,
  EntrypointPayload,
  ErrorHandlePayload,
  ErrorRaisePayload,
  FunctionDeclarationPayload,
  GuardPayload,
  StateMutationPayload,
} from './concepts.js';
// Concepts (universal cross-language review model)
export { conceptId, conceptSpan } from './concepts.js';
export type {
  ExpressSecurityLevel,
  FrameworkVersions,
  KernConfig,
  KernStructure,
  KernTarget,
  ResolvedKernConfig,
} from './config.js';
// Config
export { DEFAULT_CONFIG, mergeConfig, resolveConfig, VALID_STRUCTURES, VALID_TARGETS } from './config.js';
export type { CoverageGap } from './coverage-gap.js';
// Coverage gap emitter (v3)
export { collectCoverageGaps, readCoverageGaps, writeCoverageGaps } from './coverage-gap.js';
export { decompile } from './decompiler.js';
// Codegen errors
export { KernCodegenError, KernConfigError, KernParseError } from './errors.js';
export type {
  ActionProps,
  AssumeProps,
  BranchProps,
  CacheProps,
  CollectProps,
  ColumnProps,
  ConditionalProps,
  ConfigProps,
  ConstProps,
  DependencyProps,
  DeriveProps,
  EachProps,
  ErrorProps,
  EventProps,
  ExpectProps,
  FieldProps,
  FnProps,
  GuardProps,
  ImportProps,
  InterfaceProps,
  InvariantProps,
  MachineProps,
  MethodProps,
  ModelProps,
  ModuleProps,
  NodePropsMap,
  OnProps,
  OptionProps,
  PatternProps,
  RecoverProps,
  RelationProps,
  RepositoryProps,
  ResolveProps,
  SelectProps,
  ServiceProps,
  StateProps,
  StoreProps,
  TestProps,
  TransformProps,
  TransitionProps,
  TypeProps,
  UnionProps,
  VariantProps,
  WebSocketProps,
} from './node-props.js';
// Typed node props
export { propsOf, propsUntyped } from './node-props.js';
export type { Token, TokenKind } from './parser.js';
// Core
export {
  clearParserHints,
  getParseDiagnostics,
  getParseWarnings,
  parse,
  parseDocument,
  parseDocumentStrict,
  parseDocumentWithDiagnostics,
  parseStrict,
  parseWithDiagnostics,
  registerParserHints,
  tokenizeLine,
  unregisterParserHints,
} from './parser.js';
export type { ParserHintsConfig } from './runtime.js';
// Runtime (instance-based state)
export { defaultRuntime, KernRuntime } from './runtime.js';
export type { Detection, ScanInfo, ScanResult } from './scanner.js';
// Scanner
export { formatScanSummary, generateConfigSource, scanProject } from './scanner.js';
export type { NodeSchema, PropKind, PropSchema, SchemaViolation } from './schema.js';
// Schema validation
export { NODE_SCHEMAS, validateSchema } from './schema.js';
export type { SourceMapV3 } from './source-map.js';
// Source map serialization
export { serializeSourceMap } from './source-map.js';
// Spec
export {
  clearEvolvedTypes,
  getEvolvedTypes,
  isKnownNodeType,
  KERN_RESERVED,
  KERN_VERSION,
  NODE_TYPES,
  // Evolved types (v4)
  registerEvolvedType,
  STYLE_SHORTHANDS,
  unregisterEvolvedType,
  VALUE_SHORTHANDS,
} from './spec.js';
export { expandStyleKey, expandStyles, expandStyleValue } from './styles-react.js';
// Style engines
export { colorToTw, DEFAULT_COLORS, pxToTw, stylesToTailwind } from './styles-tailwind.js';
export type { CatalogEntry } from './template-catalog.js';
// Template catalog
export { COMMON_TEMPLATES, detectTemplates, TEMPLATE_CATALOG } from './template-catalog.js';
// Template engine
export {
  clearTemplates,
  expandTemplateNode,
  getTemplate,
  isTemplateNode,
  KernTemplateError,
  registerTemplate,
  templateCount,
} from './template-engine.js';
// Types
export type {
  DecompileResult,
  DiagnosticOutcome,
  ExprObject,
  GeneratedArtifact,
  IRNode,
  IRSourceLocation,
  KernEngine,
  ParseDiagnostic,
  ParseDiagnosticSeverity,
  ParseErrorCode,
  ParseResult,
  SourceMapEntry,
  TemplateDefinition,
  TemplateImport,
  TemplateSlot,
  TemplateSlotType,
  TranspileDiagnostic,
  TranspileResult,
} from './types.js';
export type { AccountedEntry } from './utils.js';
// Utilities
export {
  accountNode,
  buildDiagnostics,
  camelKey,
  countTokens,
  escapeJsString,
  escapeJsx,
  escapeJsxAttr,
  escapeJsxText,
  serializeIR,
} from './utils.js';
export type {
  NextjsOutputRules,
  NextjsVersionProfile,
  TailwindOutputRules,
  TailwindTokenRule,
  TailwindVersionProfile,
  VersionProfile,
} from './version-adapters.js';
export {
  applyTailwindTokenRules,
  buildNextjsProfile,
  buildTailwindProfile,
  buildVersionProfile,
} from './version-adapters.js';
// Version detection & adapters
export {
  detectVersionsFromPackageJson,
  parseMajorVersion,
  resolveNextjsMajor,
  resolveTailwindMajor,
} from './version-detect.js';
export type { Visitor, VisitorFn, VisitorMap, WalkContext } from './walk.js';
// Walker
export { getNodeAtPosition, walkIR } from './walk.js';
