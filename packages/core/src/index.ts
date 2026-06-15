/**
 * @kernlang/core — parser, types, spec, config, style engines, codegen
 */

export {
  isPostfixMutationOperator,
  isSupportedAssignOperator,
  SUPPORTED_ASSIGN_OPERATORS,
} from './assignment-operators.js';
// Slice 0.9 (browser spine cut) — the BROWSER-SAFE surface is the PARSER
// subpath (`dist/parser-expression.js` / `dist/parser.js`), proven
// typescript-free by `browser-spine-import-graph.test.ts`. This ROOT BARREL is
// NOT typescript-free (r3 review fix — the earlier comment overclaimed): it
// retains sanctioned `typescript` edges through the Node-only TS-codegen
// re-parse path (`./codegen/body-ts.js`) and the DEPRECATED 4.x-compatibility
// re-exports from `./node.js` at the bottom of this file (both pinned by the
// import-graph test; both scheduled to shrink in 5.0). Browser consumers must
// import the parser subpath, not this barrel. Node/codegen callers use:
//   import { ... } from '@kernlang/core/node';
// The browser-safe closure-classifier seam (interface + dependency-free default)
// lives in `closure-classifier.ts` and is safe to re-export from the barrel.
export type { ClosureClassifier } from './closure-classifier.js';
export {
  CLOSURE_PARSER_UNAVAILABLE_MESSAGE,
  CLOSURE_PARSER_UNAVAILABLE_REASON,
  unavailableClosureClassifier,
} from './closure-classifier.js';
export type { BodyEmitOptions, BodyEmitResult } from './codegen/body-ts.js';
export { emitNativeKernBodyTS, emitNativeKernBodyTSWithImports } from './codegen/body-ts.js';
// DECIMAL Slice 1 — shared canonical-scale contract (single-sourced fail-close
// + portability predicate consumed by BOTH the TS and Python emitters).
export {
  assertNoDecimalOperator,
  assertPortableDecimalLiteral,
  DECIMAL_BARE_CONSTRUCTION_FAILCLOSE,
  DECIMAL_OPERATOR_FAILCLOSE,
  DECIMAL_SCALE_FAILCLOSE,
  decimalBareConstructionFailMessage,
  decimalImportLineTS,
  decimalNonStringLiteralFailMessage,
  decimalOperatorFailMessage,
  decimalScaleFailMessage,
  isPortableDecimalLiteral,
  isSyntacticDecimalProducer,
} from './codegen/decimal-contract.js';
export {
  HOST_NAMESPACE_EXEMPT_ROOTS,
  isHostNamespaceRoot,
  unmappedHostNamespaceMessage,
} from './codegen/host-namespace.js';
export type { StdlibCallEntry, StdlibEntry, StdlibPropertyEntry } from './codegen/kern-stdlib.js';
export {
  applyTemplate,
  KERN_STDLIB,
  KERN_STDLIB_MODULES,
  lookupStdlib,
  lookupStdlibCall,
  lookupStdlibProperty,
  suggestStdlibMember,
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
export type { RegexCaptureMeta, RegexIFoldFailReason, RegexIFoldResult } from './codegen/regex-normalize.js';
// Milestone C, Slices 1 + /i — shared regex emission-normalization, consumed by
// the TS emitter (here in core) and the Python emitter (@kernlang/python) so the
// `\d \w \s` class transform AND the non-ASCII `/i` fold-class expansion are
// byte-identical across both targets.
export {
  // Milestone C, Slice 2 — SHARED ValueIR adapters for the regex-literal-access
  // classifier. Every ValueIR consumer (TS-emit core, Python-emit, IR-validate)
  // routes a `/x/.<prop>` read / `/x/[idx]` read / `/x/.<m>(…)` dotted call
  // through these so the fail-close decision (and message) is made by the ONE
  // classifier, agreeing with the closure-block TS-AST walk by construction.
  classifyRegexLiteralIndexReadFailClose,
  classifyRegexLiteralMemberReadFailClose,
  classifyRegexLiteralValueIRCallCalleeFailClose,
  expandRegexIFold,
  // Milestone C, Slice 2 — shared host-`RegExp` fail-close diagnostic + the
  // regex-literal portable-property predicate (the empty read allowlist, the ONE
  // seam to widen for a future portable read), both thrown/consulted byte-
  // identically by the TS and Python emitters.
  isPortableRegexLiteralProperty,
  // Milestone C, Slice 3 — shared SYNTACTIC zero-width-capable predicate, used by
  // BOTH the TS emitter and the Python emitter to make the IDENTICAL `.split`
  // fail-close decision (no host-engine probe).
  isZeroWidthCapableRegex,
  lowerRegexAnchorsPython,
  // Milestone C, Slice 4 — shared named-group PATTERN lowering (R6) so a `$<name>`
  // repl ref resolves on the Python target.
  lowerRegexNamedGroupsPython,
  normalizeRegexClasses,
  // Milestone C, Slice 5 — shared astral (non-BMP) fail-close (scanner + message),
  // thrown byte-identically by both emitters.
  REGEX_ASTRAL_FAILCLOSE_PREFIX,
  // Milestone C, Slice 3 — shared regex-method fail-close diagnostics (thrown
  // byte-identically by both emitters).
  REGEX_EXEC_FAILCLOSE,
  REGEX_HOST_REGEXP_FAILCLOSE,
  REGEX_MATCHALL_NO_G_FAILCLOSE,
  // FIX 2 — shared pattern-level fail-close for a non-portable named group
  // (`(?<café>…)`), thrown byte-identically by both emitters.
  REGEX_NAMEDGROUP_BAD_NAME_FAILCLOSE,
  // Milestone C, Slice 3c — let-bound regex detect-and-fail-close (shared
  // message + shared shape detector, used symmetrically by both emitters).
  REGEX_NONLITERAL_FAILCLOSE,
  // Milestone C, Slice 4 — shared .replace/.replaceAll replacement-string
  // fail-close diagnostics (thrown byte-identically by both emitters).
  REGEX_REPLACE_BAD_NAME_FAILCLOSE,
  REGEX_REPLACE_BEFORE_AFTER_FAILCLOSE,
  REGEX_REPLACE_NONLITERAL_REPL_FAILCLOSE,
  REGEX_REPLACE_OOR_REF_FAILCLOSE,
  REGEX_REPLACEALL_NO_G_FAILCLOSE,
  REGEX_SPLIT_LIMIT_FAILCLOSE,
  REGEX_SPLIT_ZEROWIDTH_FAILCLOSE,
  REGEX_TEST_G_FAILCLOSE,
  // Milestone C, Slice 5 — astral (non-BMP) compile-time fail-close diagnostic
  // message, thrown byte-identically by both emitters when a regex literal
  // contains a non-BMP codepoint.
  regexAstralFailMessage,
  // Milestone C, Slice 4 — shared replacement-string capture metadata (group
  // count + named set) consumed by both emitters at the .replace lowering site.
  regexCaptureMeta,
  regexIFoldFailMessage,
  // Slice 2 round 5 — shared transparent-receiver UNWRAP predicate. Resolves a
  // (possibly-wrapped) `regexLit` receiver through `typeAssert`/`nonNull`, so the
  // TS-emit, IR-validate, and Python-emit legs all screen a wrapped regex-literal
  // access (`(/x/ as any).source`, `(/x/!)["test"](s)`) identically to the bare
  // form — closing the wrapped-receiver fail-close bypass by construction.
  regexLiteralReceiverIR,
  regexMethodRegexArgIdent,
  // Milestone C, Slice 5 — shared astral (non-BMP) scanner used by both emitters
  // to detect-and-fail-close regex literals containing a non-BMP codepoint.
  scanRegexAstral,
  // Milestone C, Slice 4 — shared replacement-string translator (Python rewrite)
  // + the TS-side validator (verbatim-but-validate, lockstep symmetric).
  translateReplStringToPython,
  // Slice 2 round 7 — shared transparent-receiver UNWRAP (`typeAssert`/`nonNull`
  // fixpoint), re-exported so the Python `typeof` host-root fail-close peels a
  // WRAPPED operand (`typeof (Date as any)`) identically to the TS-emit + IR
  // legs before applying the host-root reject.
  unwrapTransparentReceiverIR,
  // FIX 2 — shared pattern-level named-group portability validator, called at the
  // TS regex-literal emit chokepoints AND the Python `pyRegexPattern` lowering so
  // a non-portable group name fail-closes symmetrically across targets.
  validateRegexNamedGroupsPortable,
  validateReplStringForTS,
} from './codegen/regex-normalize.js';
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
export {
  type ExprEmitContext,
  type ExpressionEmitResult,
  emitExpression,
  emitExpressionWithImports,
  needsArgParens,
  needsBinaryParens,
  validateDecimalConstructionArg,
} from './codegen-expression.js';
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
// Canonical constructor-super predicate — single source of truth shared by the
// validator, runtime, and both codegen targets (TS here + Python via this export).
export { hasDirectSuperCtorCall } from './constructor-super.js';
export type {
  CoreFixture,
  CoreFixtureError,
  CoreFixtureValue,
  CoreGraphEdge,
  CoreLowerings,
  CoreOperation,
  CoreOperationKind,
  CoreOperationReturns,
  CoreTypeContract,
  CoreTypeContractRegistry,
  CoreTypeKind,
  CoreTypeName,
} from './core-contracts/index.js';
export {
  BOOLEAN_CONTRACT,
  CORE_FIXTURE_FUNCTION,
  CORE_FIXTURE_UNDEFINED,
  CORE_TYPE_CONTRACTS,
  CORE_TYPE_NAMES,
  CoreContractEvaluationError,
  contractToGraphEdges,
  coreFixtureValueType,
  evaluateCoreContractOperation,
  FUNCTION_CONTRACT,
  isCoreFixtureFunction,
  isCoreFixtureUndefined,
  LIST_CONTRACT,
  NULL_CONTRACT,
  NUMBER_CONTRACT,
  RECORD_CONTRACT,
  STRING_CONTRACT,
  UNDEFINED_CONTRACT,
} from './core-contracts/index.js';
export {
  CoreRuntimeContractAdapterError,
  coreFixtureValueToKernValue,
  kernValueToCoreFixtureValue,
  roundTripKernContractDataValue,
} from './core-runtime/contract-adapter.js';
export type {
  CoreCompletion,
  CoreRuntimeResult,
  CreateCoreRuntimeEnvOptions,
  KernBuiltinValue,
  KernFunctionValue,
  KernValue,
  RuntimeParam,
} from './core-runtime/index.js';
// KERN Core Runtime
export {
  CoreRuntimeEnv,
  callCoreFunction,
  createCoreRuntimeEnv,
  evalCoreExpression,
  fromHostValue,
  kBoolean,
  kernTruthy,
  kNull,
  kNumber,
  kString,
  kUndefined,
  runCoreRuntime,
  toHostValue,
} from './core-runtime/index.js';
export type {
  CoreShapeDiagnostic,
  CoreShapeDiagnosticCode,
  CoreShapeFacts,
  CoreShapeFieldFact,
  CoreShapeIndexerFact,
  CoreShapeInterfaceFact,
  CoreShapeValidationResult,
} from './core-runtime/shape-validator.js';
export { assertCoreShape, collectCoreShapeFacts, validateCoreShape } from './core-runtime/shape-validator.js';
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
// Slice 0.9 — the TS → .kern importer (`importer.ts`) statically imports
// `typescript`, so it moved to the Node subpath `@kernlang/core/node` to keep
// this barrel typescript-free. `ImportResult`/`escapeKernString`/`importTypeScript`
// are re-exported from there.
export type { InstanceofRhsRejectReason } from './instanceof-rhs.js';
export {
  INSTANCEOF_RHS_BUILTIN_REJECT,
  INSTANCEOF_RHS_WRAPPER_REJECT,
  instanceofRhsPythonType,
  instanceofRhsRejectReasonForName,
} from './instanceof-rhs.js';
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
// ToNumericPrimitive decision kernel — slice-0.75 substrate (browser-safe).
export type { KernNumericInput, NumericResult } from './ir/semantics/to-numeric.js';
export {
  ECMA_STR_WHITESPACE,
  KERN_UNDEFINED_SENTINEL,
  numberToInt32,
  numberToIntegerOrInfinity,
  numberToUint32,
  stringToNumber,
  toInt32,
  toIntegerOrInfinity,
  toNumber,
  toUint32,
} from './ir/semantics/to-numeric.js';
// NOTE: the to-numeric differential FIXTURE arrays are deliberately NOT
// exported from this public barrel (review finding: battery data is not
// shipped runtime API). Test legs import './ir/semantics/to-numeric-fixtures.js'
// (or its dist path) directly.
export type { GapCategory, GapClassification } from './migrate-literals.js';
export { classifyHandlerGap, isInlineSafeExpression, isInlineSafeLiteral } from './migrate-literals.js';
// Native KERN handler eligibility (slice 5a) — browser-safe fence/regex layer.
// `extractRawBodies`/`isExplicitForeignRawBody` are dependency-free; the
// TypeScript-AST classifier (`classifyHandlerBody`/`scanFileForEligibility` bound
// to the walker, plus `classifyHandlerBodyAst` and the migrator helpers) lives
// at `@kernlang/core/node` to keep this barrel typescript-free (slice 0.9).
export type { EligibilityResult, FileEligibilityReport, HandlerBodyClassifier, RawBody } from './native-eligibility.js';
export { extractRawBodies, isExplicitForeignRawBody } from './native-eligibility.js';
// ── DEPRECATED root-barrel compatibility (slice 0.9 review fix) ─────────────
// These APIs moved to the `@kernlang/core/node` subpath (the single
// TypeScript-dependent entrypoint). They are re-exported here ONLY so the move
// is not a semver break inside the 4.x line — importing ANY of them from the
// root barrel drags `typescript` (~10MB) into the consumer's module graph.
// Browser consumers must use the parser subpath / barrel WITHOUT these names.
/** @deprecated import from `@kernlang/core/node` instead — scheduled for removal in 5.0. */
export type {
  AstEligibilityResult,
  ImportResult,
  LowerJsClosureBodyToPythonOptions,
  LowerJsClosureBodyToPythonResult,
} from './node.js';
/** @deprecated import from `@kernlang/core/node` instead — scheduled for removal in 5.0. */
export {
  canonicalKernExpression,
  canonicalObjectEntriesSource,
  classifyClosureBlock,
  classifyHandlerBody,
  classifyHandlerBodyAst,
  collectFreeIdentifierNames,
  escapeKernString,
  hasComments,
  hasOnlyMigratableComments,
  hasTsOnlyTemplateEscape,
  importTypeScript,
  isValidKernAssignmentTarget,
  isValidKernAssignmentValue,
  isValidKernExpression,
  isValidKernTypeAnnotation,
  lowerJsClosureBodyToPython,
  parseClosureBlockAst,
  scanFileForEligibility,
  supportedCompoundAssignmentOperator,
} from './node.js';
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
export type { ParseExpressionOptions } from './parser-expression.js';
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
export type { RagAssertionKind } from './rag-assertions.js';
export { RAG_ASSERTION_KIND_SET, RAG_ASSERTION_KINDS } from './rag-assertions.js';
export type {
  InMemoryRagRetriever,
  ProvenancedRetrieveResult,
  RagAnswerContract,
  RagAnswerContractDiagnostic,
  RagAnswerContractDiagnosticCode,
  RagAnswerContractResult,
  RagAnswerContractStatus,
  RagAnswerGroundingSpan,
  RagChunkInput,
  RagCitation,
  RagContractRetriever,
  RagEvalAssertionCode,
  RagEvalAssertionResult,
  RagEvalCaseResult,
  RagEvalContractOptions,
  RagEvalContractResult,
  RagMcpRetrieveProvenanceMapping,
  RagRuntimeProvenance,
  RagRuntimeProvenanceOptions,
  RagRuntimeProvenanceStatus,
  RagSemanticAnswerContractOptions,
  RetrievedChunk,
  RetrieveOptions,
  RetrieveResult,
} from './rag-runtime.js';
export {
  createInMemoryRetriever,
  createRagRuntimeProvenance,
  evaluateRagAnswerContract,
  evaluateRagEvalContract,
  evaluateRagSemanticAnswerContract,
  hashRetrievedChunkText,
  InMemoryRagCorpus,
  MAX_IN_MEMORY_RAG_TOP_K,
  ragAnswerContractFromSemanticFact,
  ragMcpRetrieveProvenanceMapping,
  retrieveFromInMemoryCorpus,
  tokenizeForRetrieval,
  withRagRuntimeProvenance,
} from './rag-runtime.js';
export type { ParserHintsConfig } from './runtime.js';
// Runtime (instance-based state)
export { defaultRuntime, KernRuntime } from './runtime.js';
export type { Detection, ScanInfo, ScanResult } from './scanner.js';
// Scanner
export { formatScanSummary, generateConfigSource, scanProject } from './scanner.js';
export type { KernSchemaJSON, NodeSchema, PropKind, PropSchema, SchemaViolation } from './schema.js';
// Schema validation + export
export { exportSchemaJSON, NODE_SCHEMAS, validateSchema } from './schema.js';
export type {
  BuildKernSemanticSubstrateOptions,
  KernSemanticCoreOperation,
  KernSemanticCoreType,
  KernSemanticIrContract,
  KernSemanticPrimitive,
  KernSemanticRagAnswerReviewFact,
  KernSemanticRagAnswerReviewStatus,
  KernSemanticStdlibOperation,
  KernSemanticSubstrate,
  KernSemanticSubstrateSource,
  KernSemanticSubstrateTarget,
  KernSemanticSupport,
  KernSemanticValidationSummary,
} from './semantic-substrate.js';
export {
  buildKernSemanticSubstrate,
  lookupSemanticPrimitive,
  semanticPrimitiveSupportSummary,
} from './semantic-substrate.js';
// Semantic validation
export type {
  ClassSemanticClassFact,
  ClassSemanticConstructorFact,
  ClassSemanticConstructorSuperStatus,
  ClassSemanticFacts,
  ClassSemanticImplementsEdge,
  ClassSemanticInheritanceEdge,
  ClassSemanticLocation,
  ClassSemanticMemberFact,
  ClassSemanticMemberKind,
  ClassSemanticOverrideFact,
  ClassSemanticOverrideStatus,
  ClassSemanticProtocolConformanceFact,
  ClassSemanticProtocolStatus,
  RagSemanticAnswerContractFact,
  RagSemanticAnswerSpanFact,
  RagSemanticChunkingFact,
  RagSemanticCorpusFact,
  RagSemanticEmbedFact,
  RagSemanticEvalAssertFact,
  RagSemanticEvalCaseFact,
  RagSemanticEvalFact,
  RagSemanticFacts,
  RagSemanticGroundingFact,
  RagSemanticLocation,
  RagSemanticMcpRetrievalFact,
  RagSemanticPipelineFact,
  RagSemanticRetrieverFact,
  RagSemanticSourceFact,
  SemanticViolation,
} from './semantic-validator.js';
export {
  collectClassSemanticFacts,
  collectRagSemanticFacts,
  RAG_MCP_RETRIEVE_OUTPUT_ITEM_SHAPE,
  RAG_MCP_RETRIEVE_OUTPUT_SHAPE,
  validateClassSemantics,
  validateRagSemantics,
  validateSemantics,
} from './semantic-validator.js';
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
