/**
 * @kernlang/core — parser, types, spec, config, style engines, codegen
 */

export {
  isPostfixMutationOperator,
  isSupportedAssignOperator,
  SUPPORTED_ASSIGN_OPERATORS,
  supportedCompoundAssignmentOperator,
} from './assignment-operators.js';
export type {
  LowerJsClosureBodyToPythonOptions,
  LowerJsClosureBodyToPythonResult,
} from './closure-python-lowering.js';
export { lowerJsClosureBodyToPython } from './closure-python-lowering.js';
export type { BodyEmitOptions, BodyEmitResult } from './codegen/body-ts.js';
export { emitNativeKernBodyTS, emitNativeKernBodyTSWithImports } from './codegen/body-ts.js';
export type { StdlibEntry } from './codegen/kern-stdlib.js';
export {
  applyTemplate,
  KERN_STDLIB,
  KERN_STDLIB_MODULES,
  lookupStdlib,
  suggestStdlibMethod,
} from './codegen/kern-stdlib.js';
export type {
  PortableLogicIntent,
  PortableLogicPrimitive,
  PortableLogicPrimitiveId,
  PortableLogicPurity,
  PortableLogicSupport,
  PortableLogicTarget,
} from './codegen/portable-logic-primitives.js';
export {
  lookupPortableLogicPrimitive,
  PORTABLE_LOGIC_PRIMITIVE_IDS,
  PORTABLE_LOGIC_PRIMITIVES,
  portableLogicSupportForTarget,
  validatePortableLogicPrimitiveRegistry,
} from './codegen/portable-logic-primitives.js';
export type { ReactHookDep } from './codegen/react-hook-imports.js';
export { detectReactHookDeps, injectReactHookImports } from './codegen/react-hook-imports.js';
export type { KernStdlibUsage } from './codegen/stdlib-preamble.js';
// Slice 4 layer 2 — Result / Option compact form preamble (TS-family targets)
export {
  detectKernStdlibUsage,
  injectKernStdlibPreamble,
  injectKernStdlibPreambleIntoSFC,
  kernStdlibPreamble,
} from './codegen/stdlib-preamble.js';
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
  // Slice 3c — structured `param` child nodes for fn parameter defaults via ValueIR
  emitParamList,
  emitPath,
  emitReasonAnnotations,
  // Render body emitter — exported so target transpilers (Ink, Vue, …) can
  // delegate composed-mode (wrapper / each / conditional / local) emission
  // to a single source of truth instead of re-implementing it per target.
  emitRender,
  emitStringKeyArray,
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
  parseKeys,
  parseParamList,
  parseParamListFromChildren,
  // Evolved generators — prefer KernRuntime for new code
  registerEvolvedGenerator,
  registerEvolvedTargetGenerator,
  SEMANTIC_TYPE_MAP,
  sourceComment,
  unregisterEvolvedGenerator,
} from './codegen-core.js';
// Native KERN handler bodies (slice 2a/2b/2c) — stdlib lowering table for
// cross-target method dispatch. `applyTemplate` is the shared placeholder
// substitution; `needsBinaryParens` is the shared precedence-aware paren
// predicate so Python codegen reuses the same rule.
export { emitExpression, needsArgParens, needsBinaryParens } from './codegen-expression.js';
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
export {
  ALL_TARGETS,
  DEFAULT_CONFIG,
  detectTarget,
  mergeConfig,
  resolveConfig,
  VALID_STRUCTURES,
  VALID_TARGETS,
} from './config.js';
export type { CoverageGap } from './coverage-gap.js';
// Coverage gap emitter (v3)
export { collectCoverageGaps, readCoverageGaps, writeCoverageGaps } from './coverage-gap.js';
export { decompile } from './decompiler.js';
export type { ExternalSignatureMap } from './ecosystem-signatures.js';
export {
  inferExternalSignature,
  inferExternalSignatureMap,
  parseExternalSignatureMap,
} from './ecosystem-signatures.js';
// Codegen errors
export type { CodegenErrorCode } from './errors.js';
export { KernCodegenError, KernConfigError, KernParseError } from './errors.js';
export type {
  CapabilityIsland,
  ExternalBoundary,
  ExternalImportBinding,
  SidecarManifest,
  SidecarPackage,
} from './external-boundary.js';
export {
  collectCapabilityIslands,
  collectExternalBoundaries,
  collectSidecarManifests,
  sidecarManifestFromIsland,
  sidecarManifestFromNode,
} from './external-boundary.js';
export type {
  ExternalImportSymbol,
  ExternalImportSymbolConflict,
  ExternalImportSymbolKind,
  ExternalImportSymbolTable,
  ExternalNamedBinding,
  ExternalSignatureDiagnostic,
} from './external-symbols.js';
export {
  buildExternalImportSymbolTable,
  collectExternalImportSymbols,
  externalSignatureDiagnostics,
  parseExternalNamedBinding,
  signatureMapForSidecarPackage,
} from './external-symbols.js';
export type {
  CapabilityEffect,
  CapabilityRuntime,
  CapabilitySerialization,
  ExternalImportRegistry,
  ExternalImportTarget,
} from './import-metadata.js';
export {
  importRegistryOf,
  importTargetFamilyOf,
  importTargetOf,
  shouldEmitImportForTarget,
  splitCapabilityList,
  validateCapabilityMetadata,
  validateImportMetadata,
} from './import-metadata.js';
// TS → .kern importer
export type { ImportResult } from './importer.js';
export { escapeKernString, importTypeScript } from './importer.js';
export {
  expressionV1Contract,
  registerExpressionV1Contract,
} from './ir/semantics/expression-v1.js';
export type { LowerTarget } from './ir/semantics/fixture-lowering.js';
export { lowerFixtureForTarget, serializeValue } from './ir/semantics/fixture-lowering.js';
// IR runtime semantics — executable contracts + differential harness.
export type {
  CanonicalError,
  CompletionKind,
  CompletionRecord,
  ContractDoc,
  DifferentialResult,
  FixtureSample,
  NodeContract,
  NodeFixture,
  RegistryDoc,
  SemanticEnv,
  Trace,
  TraceEvent,
  Verdict,
} from './ir/semantics/index.js';
export {
  CONTRACT_REGISTRY,
  completionsEqual,
  deepEqual,
  emptyTrace,
  eventsEqual,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  referenceRunSequence,
  registerAllContracts,
  registerContract,
  runAllContracts,
  runDifferential,
  serializeJson,
  serializeMarkdown,
  snapshotRegistry,
  tracesEqual,
} from './ir/semantics/index.js';
export type { GapCategory, GapClassification } from './migrate-literals.js';
export { classifyHandlerGap, isInlineSafeExpression, isInlineSafeLiteral } from './migrate-literals.js';
// Native KERN handler eligibility (slice 5a) — heuristic classifier used by
// the diagnostic layer and the future `kern migrate native-handlers` CLI.
export type { EligibilityResult, FileEligibilityReport, RawBody } from './native-eligibility.js';
export {
  classifyHandlerBody,
  extractRawBodies,
  isExplicitForeignRawBody,
  scanFileForEligibility,
} from './native-eligibility.js';
// Slice α-3: AST-walker classifier + shared helpers (migrator imports these).
export type { AstEligibilityResult } from './native-eligibility-ast.js';
export {
  canonicalKernExpression,
  canonicalObjectEntriesSource,
  classifyHandlerBodyAst,
  hasComments,
  hasOnlyMigratableComments,
  hasTsOnlyTemplateEscape,
  isValidKernAssignmentTarget,
  isValidKernAssignmentValue,
  isValidKernExpression,
  isValidKernTypeAnnotation,
} from './native-eligibility-ast.js';
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
  MemoProps,
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
export type { ParseOptions } from './parser-core.js';
// Native KERN handler bodies (slice 1) — expression parsing + body emit
export { parseExpression } from './parser-expression.js';
// Exported so unit tests can drive the validator directly with hand-built IR
// (the parser drops `lang="kern" <<< raw >>>` bodies, so the lang-skip branch
// can't be exercised end-to-end through the parser).
export { collectNativeEligibleHints, validateNativeEligible } from './parser-validate-native-eligible.js';
// Slice 7 v2 — cross-module recognition surface for `?`/`!` propagation.
export type { ImportResolver, ModuleExportSymbol, ModuleExports } from './parser-validate-propagation.js';
export { splitPortableExpressionList } from './portable-expression-list.js';
export type {
  PortablePredicateArrayOp,
  PortablePredicateCompareOp,
  PortablePredicateExistsOp,
  PortablePredicateMembershipOp,
  PortablePredicateParseResult,
  PortablePredicateStringOp,
  PortablePredicateUnaryOp,
} from './portable-predicate.js';
export {
  PORTABLE_PREDICATE_ARRAY_OPS,
  PORTABLE_PREDICATE_COMPARE_OPS,
  PORTABLE_PREDICATE_EXISTS_OPS,
  PORTABLE_PREDICATE_MEMBERSHIP_OPS,
  PORTABLE_PREDICATE_STRING_OPS,
  PORTABLE_PREDICATE_UNARY_OPS,
  parsePortablePredicateProp,
  validatePortablePredicateAST,
} from './portable-predicate.js';
export { parsePortableNonNegativeIntLiteral, parsePortablePathSegments } from './portable-route-collection.js';
export type { ParserHintsConfig } from './runtime.js';
// Runtime (instance-based state)
export { defaultRuntime, KernRuntime } from './runtime.js';
export type { Detection, ScanInfo, ScanResult } from './scanner.js';
// Scanner
export { formatScanSummary, generateConfigSource, scanProject } from './scanner.js';
export type { KernSchemaJSON, NodeSchema, PropKind, PropSchema, SchemaViolation } from './schema.js';
// Schema validation + export
export { exportSchemaJSON, NODE_SCHEMAS, validateSchema } from './schema.js';
// Semantic validation
export type { SemanticViolation } from './semantic-validator.js';
export { validateSemantics } from './semantic-validator.js';
export type { ShadowAnalyzeOptions, ShadowDiagnostic } from './shadow-analyzer.js';
export { analyzeShadow } from './shadow-analyzer.js';
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
  DiagnosticCategory,
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
// Type guards (value exports — must be in a `export {}` block, not `export type {}`)
export { isExprObject } from './types.js';
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
export type { BinaryOp, UnaryOp, ValueIR, ValueIRKind } from './value-ir.js';
export { isValueIR } from './value-ir.js';
export type {
  NextjsOutputRules,
  NextjsVersionProfile,
  ReactOutputRules,
  ReactVersionProfile,
  TailwindOutputRules,
  TailwindTokenRule,
  TailwindVersionProfile,
  VersionProfile,
} from './version-adapters.js';
export {
  applyTailwindTokenRules,
  buildNextjsProfile,
  buildReactProfile,
  buildTailwindProfile,
  buildVersionProfile,
} from './version-adapters.js';
// Version detection & adapters
export {
  detectVersionsFromPackageJson,
  parseMajorVersion,
  resolveNextjsMajor,
  resolveReactMajor,
  resolveTailwindMajor,
} from './version-detect.js';
export type { Visitor, VisitorFn, VisitorMap, WalkContext } from './walk.js';
// Walker
export { getNodeAtPosition, walkIR } from './walk.js';
