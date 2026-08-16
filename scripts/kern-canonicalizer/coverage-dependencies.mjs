import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reconstructHistoricalSource } from './historical-source.mjs';
import {
  historicalTransitionStage,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';
import { POST_BRANCH_COMPILED_CONSTITUTION_RECONSTRUCTIONS } from './branch-path-structural-target.mjs';
import {
  DECIMAL_ADMISSION_ISOLATION_HISTORICAL_TRANSITION,
  POST_DECIMAL_ADMISSION_ISOLATION_COMPILED_RECONSTRUCTIONS,
  validateDecimalAdmissionIsolationHistoricalTransition,
} from './decimal-admission-isolation-historical-transition.mjs';
import {
  ENVIRONMENT_QUARANTINE_HISTORICAL_TRANSITION,
  POST_ENVIRONMENT_QUARANTINE_COMPILED_RECONSTRUCTIONS,
  validateEnvironmentQuarantineHistoricalTransition,
} from './environment-quarantine-historical-transition.mjs';
import { POST_EACH_COMPILED_CONSTITUTION_RECONSTRUCTIONS } from './each-collection-structural-target.mjs';
import {
  EXECUTION_CONTEXT_HARDENING_FORMAT_HISTORICAL_TRANSITION,
  POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS,
  validateExecutionContextHardeningFormatHistoricalTransition,
} from './execution-context-hardening-format-historical-transition.mjs';
import {
  EXECUTION_CONTEXT_HARDENING_HISTORICAL_TRANSITION,
  POST_EXECUTION_CONTEXT_HARDENING_COMPILED_RECONSTRUCTIONS,
  validateExecutionContextHardeningHistoricalTransition,
} from './execution-context-hardening-historical-transition.mjs';
import {
  EXECUTION_CONTEXT_ISOLATION_HISTORICAL_TRANSITION,
  POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS,
  validateExecutionContextIsolationHistoricalTransition,
} from './execution-context-isolation-historical-transition.mjs';
import {
  EXECUTION_METADATA_HARDENING_HISTORICAL_TRANSITION,
  POST_EXECUTION_METADATA_HARDENING_COMPILED_RECONSTRUCTIONS,
  validateExecutionMetadataHardeningHistoricalTransition,
} from './execution-metadata-hardening-historical-transition.mjs';
import { POST_LAMBDA_COMPILED_CONSTITUTION_RECONSTRUCTIONS } from './lambda-runner-structural-target.mjs';
import {
  LEGACY_TRACE_COMPACTION_HISTORICAL_TRANSITION,
  POST_LEGACY_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS,
  validateLegacyTraceCompactionHistoricalTransition,
} from './legacy-trace-compaction-historical-transition.mjs';
import {
  POST_M4153_COMPILED_CONSTITUTION_RECONSTRUCTIONS,
  PRE_M4135_COMPILED_EXPRESSION_REPLACEMENTS,
} from './new-expression-structural-target.mjs';
import { POST_M4171_COMPILED_PARSER_STYLE_RECONSTRUCTIONS } from './parser-style-containment-target.mjs';
import {
  POST_RUNTIME_TEXT_CACHE_COMPILED_RECONSTRUCTIONS,
  RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION,
  RUNTIME_TEXT_CACHE_TYPE_ONLY_COMPILED_IDENTITIES,
} from './runtime-text-cache-historical-transition.mjs';
import { scalarHelperHistoryOverrides } from './scalar-helper-history-coverage-adapter.mjs';
import {
  POST_TEXT_SPLICE_COMPILED_RUNTIME_RECONSTRUCTIONS,
  TEXT_SPLICE_COMPILED_SUCCESSOR_TRANSITION,
} from './text-splice-historical-transition.mjs';
import {
  POST_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS,
  TRACE_COMPACTION_TYPE_ONLY_COMPILED_IDENTITIES,
  validateTraceCompactionHistoricalTransition,
} from './trace-compaction-historical-transition.mjs';
import {
  POST_TRACE_RETENTION_OWNERSHIP_COMPILED_RECONSTRUCTIONS,
  RESTORED_TRACE_RETENTION_COMPILED,
  TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION,
  validateTraceRetentionOwnershipHistoricalTransition,
} from './trace-retention-ownership-historical-transition.mjs';
import {
  POST_TRACE_RETENTION_ROOT_COMPILED_RECONSTRUCTIONS,
  TRACE_RETENTION_ROOT_HISTORICAL_TRANSITION,
  validateTraceRetentionRootHistoricalTransition,
} from './trace-retention-root-historical-transition.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const COMPILED_CORE_ROOT = resolve(ROOT, 'packages/core/dist');
const IMPLEMENTATION_ROOT = resolve(ROOT, 'scripts/kern-canonicalizer');
const M4145_SUCCESSOR_COMPILED_CORE_INVENTORY =
  RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION.currentInventory;
const POST_M4145_COMPILED_CORE_PATHS = Object.freeze([
  'each-collection-reference.js',
  'kir-v1/canonical.js',
  'kir-v1/types.js',
  'kir-structural/branch-path-value.js',
  'kir-structural/each-collection-reference.js',
  'kir-structural/runtime-inflate.js',
  'mutable-node-type-registry-snapshot.js',
  'parser-hint-snapshot.js',
  'runtime-envelope/kir-handler.js',
  ...TEXT_SPLICE_COMPILED_SUCCESSOR_TRANSITION.addedPaths,
  ...RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION.addedPaths,
]);

let authenticatedDependencies;

function fail(message) {
  throw new TypeError(`coverage dependency rejection: ${message}`);
}

function hashFramedFiles(root, paths, overrides = new Map()) {
  const canonicalRoot = realpathSync(root);
  const hash = createHash('sha256');
  for (const name of [...paths].sort()) {
    const path = resolve(canonicalRoot, name);
    const stat = lstatSync(path);
    const real = realpathSync(path);
    const relativePath = relative(canonicalRoot, real);
    const escaped = relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
    if (!stat.isFile() || real !== path || escaped) fail(`${name} must be a contained regular file`);
    const bytes = overrides.get(name) ?? readFileSync(path);
    hash.update(`${name.length}:${name}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function hashPathInventory(paths) {
  const hash = createHash('sha256');
  for (const name of [...paths].sort()) hash.update(`${name.length}:${name}`);
  return hash.digest('hex');
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertCanonicalRelativeJavaScriptPaths(paths, label) {
  if (!Array.isArray(paths)) {
    fail(`${label} must be an array`);
  }
  const seen = new Set();
  for (const name of paths) {
    const segments = typeof name === 'string' ? name.split('/') : [];
    if (
      segments.length === 0 ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      !name.endsWith('.js') ||
      isAbsolute(name) ||
      name.includes('\\') ||
      seen.has(name)
    ) {
      fail(`${label} must contain unique normalized relative JavaScript paths`);
    }
    seen.add(name);
  }
}

function compiledJavaScriptFiles(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`compiled core entry ${path} must not be a symlink`);
    if (entry.isDirectory()) compiledJavaScriptFiles(path, output);
    else if (entry.isFile() && entry.name.endsWith('.js')) output.push(path);
  }
  return output;
}

function compiledCoreJavaScriptPaths() {
  const stat = lstatSync(COMPILED_CORE_ROOT);
  if (!stat.isDirectory()) fail('compiled core root must be a regular directory');
  const canonicalRoot = realpathSync(COMPILED_CORE_ROOT);
  const paths = compiledJavaScriptFiles(canonicalRoot)
    .map((path) => relative(canonicalRoot, path).split(sep).join('/'));
  if (paths.length === 0) fail('compiled core JavaScript must not be empty');
  assertCanonicalRelativeJavaScriptPaths(paths, 'compiled core inventory');
  return { canonicalRoot, paths };
}

export function reconstructM4145CompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths, 'M4.145 successor compiled core inventory');
  if (
    paths.length !== M4145_SUCCESSOR_COMPILED_CORE_INVENTORY.count ||
    hashPathInventory(paths) !== M4145_SUCCESSOR_COMPILED_CORE_INVENTORY.digest
  ) {
    fail('M4.145 historical membership requires the authenticated successor inventory');
  }
  const runtimeTextCacheSuccessors = new Set(
    RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION.addedPaths,
  );
  if (
    RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION.addedPaths.some(
      (path) => !paths.includes(path),
    )
  ) {
    fail('runtime text cache successor paths must exist in the authenticated inventory');
  }
  const preRuntimeTextCachePaths = paths.filter((path) => !runtimeTextCacheSuccessors.has(path));
  const runtimeTextCachePredecessor =
    RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION.predecessorInventory;
  if (
    preRuntimeTextCachePaths.length !== runtimeTextCachePredecessor.count ||
    hashPathInventory(preRuntimeTextCachePaths) !== runtimeTextCachePredecessor.digest
  ) {
    fail('runtime text cache predecessor inventory must reproduce the Text.splice successor');
  }
  const textSpliceSuccessor = TEXT_SPLICE_COMPILED_SUCCESSOR_TRANSITION.currentInventory;
  if (
    preRuntimeTextCachePaths.length !== textSpliceSuccessor.count ||
    hashPathInventory(preRuntimeTextCachePaths) !== textSpliceSuccessor.digest
  ) {
    fail('runtime text cache predecessor must authenticate the frozen Text.splice inventory');
  }
  assertCanonicalRelativeJavaScriptPaths(
    POST_M4145_COMPILED_CORE_PATHS,
    'post-M4.145 compiled core paths',
  );
  const successors = new Set(POST_M4145_COMPILED_CORE_PATHS);
  if (POST_M4145_COMPILED_CORE_PATHS.some((path) => !paths.includes(path))) {
    fail('post-M4.145 compiled core paths must exist in the authenticated successor inventory');
  }
  const historicalPaths = paths.filter((path) => !successors.has(path));
  if (historicalPaths.length + successors.size !== paths.length) {
    fail('M4.145 historical membership must remove every successor path exactly once');
  }
  return historicalPaths;
}

export function reconstructLegacyTraceCompactionCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths, 'legacy trace-compaction successor compiled core inventory');
  const transition = LEGACY_TRACE_COMPACTION_HISTORICAL_TRANSITION;
  if (
    paths.length !== transition.compiledInventory.successor.count ||
    hashPathInventory(paths) !== transition.compiledInventory.successor.digest
  ) {
    fail('legacy trace-compaction historical membership requires the authenticated successor inventory');
  }
  const added = new Set(transition.addedCompiledPaths.map((identity) => identity.path));
  if ([...added].some((path) => !paths.includes(path))) {
    fail('legacy trace-compaction added paths must exist in the authenticated inventory');
  }
  const predecessorPaths = paths.filter((path) => !added.has(path));
  if (
    predecessorPaths.length !== transition.compiledInventory.predecessor.count ||
    hashPathInventory(predecessorPaths) !== transition.compiledInventory.predecessor.digest
  ) {
    fail('legacy trace-compaction predecessor inventory must reproduce the F1 successor');
  }
  return predecessorPaths;
}

export function reconstructTraceRetentionOwnershipCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths, 'trace-retention ownership successor compiled core inventory');
  const transition = TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION;
  if (
    paths.length !== transition.compiledInventory.successor.count ||
    hashPathInventory(paths) !== transition.compiledInventory.successor.digest
  ) {
    fail('trace-retention ownership historical membership requires the authenticated successor inventory');
  }
  const restoredPath = transition.restoredCompiledPath.path;
  if (paths.includes(restoredPath)) {
    fail('trace-retention ownership successor inventory must exclude the restored predecessor path');
  }
  const predecessorPaths = [...paths, restoredPath].sort();
  if (
    predecessorPaths.length !== transition.compiledInventory.predecessor.count ||
    hashPathInventory(predecessorPaths) !== transition.compiledInventory.predecessor.digest
  ) {
    fail('trace-retention ownership predecessor inventory must reproduce the 36d0 successor');
  }
  return predecessorPaths;
}

export function validateTraceRetentionRootCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths, 'trace-retention root successor compiled core inventory');
  const transition = TRACE_RETENTION_ROOT_HISTORICAL_TRANSITION;
  const identity = { count: paths.length, digest: hashPathInventory(paths) };
  if (
    identity.count !== transition.compiledInventory.successor.count ||
    identity.digest !== transition.compiledInventory.successor.digest ||
    identity.count !== transition.compiledInventory.predecessor.count ||
    identity.digest !== transition.compiledInventory.predecessor.digest
  ) {
    fail('trace-retention root transition requires an unchanged authenticated inventory');
  }
  return paths;
}

export function validateExecutionContextIsolationCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(
    paths,
    'execution-context isolation successor compiled core inventory',
  );
  const transition = EXECUTION_CONTEXT_ISOLATION_HISTORICAL_TRANSITION;
  const identity = { count: paths.length, digest: hashPathInventory(paths) };
  if (
    identity.count !== transition.compiledInventory.successor.count ||
    identity.digest !== transition.compiledInventory.successor.digest ||
    identity.count !== transition.compiledInventory.predecessor.count ||
    identity.digest !== transition.compiledInventory.predecessor.digest
  ) {
    fail('execution-context isolation transition requires an unchanged authenticated inventory');
  }
  return paths;
}

export function validateExecutionContextHardeningCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(
    paths,
    'execution-context hardening successor compiled core inventory',
  );
  const transition = EXECUTION_CONTEXT_HARDENING_HISTORICAL_TRANSITION;
  const identity = { count: paths.length, digest: hashPathInventory(paths) };
  if (
    identity.count !== transition.compiledInventory.successor.count ||
    identity.digest !== transition.compiledInventory.successor.digest ||
    identity.count !== transition.compiledInventory.predecessor.count ||
    identity.digest !== transition.compiledInventory.predecessor.digest
  ) {
    fail('execution-context hardening transition requires an unchanged authenticated inventory');
  }
  return paths;
}

export function validateExecutionContextHardeningFormatCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(
    paths,
    'execution-context hardening format successor compiled core inventory',
  );
  const transition = EXECUTION_CONTEXT_HARDENING_FORMAT_HISTORICAL_TRANSITION;
  const identity = { count: paths.length, digest: hashPathInventory(paths) };
  if (
    identity.count !== transition.compiledInventory.successor.count ||
    identity.digest !== transition.compiledInventory.successor.digest ||
    identity.count !== transition.compiledInventory.predecessor.count ||
    identity.digest !== transition.compiledInventory.predecessor.digest
  ) {
    fail('execution-context hardening format transition requires an unchanged authenticated inventory');
  }
  return paths;
}

export function validateExecutionMetadataHardeningCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths, 'execution-metadata hardening successor compiled core inventory');
  const transition = EXECUTION_METADATA_HARDENING_HISTORICAL_TRANSITION;
  const identity = { count: paths.length, digest: hashPathInventory(paths) };
  if (
    identity.count !== transition.compiledInventory.successor.count ||
    identity.digest !== transition.compiledInventory.successor.digest ||
    identity.count !== transition.compiledInventory.predecessor.count ||
    identity.digest !== transition.compiledInventory.predecessor.digest
  ) {
    fail('execution-metadata hardening transition requires an unchanged authenticated inventory');
  }
  return paths;
}

export function validateDecimalAdmissionIsolationCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths, 'decimal-admission isolation successor compiled core inventory');
  const transition = DECIMAL_ADMISSION_ISOLATION_HISTORICAL_TRANSITION;
  const identity = { count: paths.length, digest: hashPathInventory(paths) };
  if (
    identity.count !== transition.compiledInventory.successor.count ||
    identity.digest !== transition.compiledInventory.successor.digest ||
    identity.count !== transition.compiledInventory.predecessor.count ||
    identity.digest !== transition.compiledInventory.predecessor.digest
  ) {
    fail('decimal-admission isolation transition requires an unchanged authenticated inventory');
  }
  return paths;
}

export function validateEnvironmentQuarantineCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths, 'environment quarantine successor compiled core inventory');
  const transition = ENVIRONMENT_QUARANTINE_HISTORICAL_TRANSITION;
  const identity = { count: paths.length, digest: hashPathInventory(paths) };
  if (
    identity.count !== transition.compiledInventory.successor.count ||
    identity.digest !== transition.compiledInventory.successor.digest ||
    identity.count !== transition.compiledInventory.predecessor.count ||
    identity.digest !== transition.compiledInventory.predecessor.digest
  ) {
    fail('environment quarantine transition requires an unchanged authenticated inventory');
  }
  return paths;
}

function m4145CompiledCoreJavaScriptPaths() {
  validateEnvironmentQuarantineHistoricalTransition();
  validateDecimalAdmissionIsolationHistoricalTransition();
  validateExecutionMetadataHardeningHistoricalTransition();
  validateExecutionContextHardeningFormatHistoricalTransition();
  validateExecutionContextHardeningHistoricalTransition();
  validateExecutionContextIsolationHistoricalTransition();
  validateTraceRetentionRootHistoricalTransition();
  validateTraceRetentionOwnershipHistoricalTransition();
  validateLegacyTraceCompactionHistoricalTransition();
  validateTraceCompactionHistoricalTransition();
  const { canonicalRoot, paths } = compiledCoreJavaScriptPaths();
  const restoredTraceRetention = TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION.restoredCompiledPath;
  if (hashBytes(RESTORED_TRACE_RETENTION_COMPILED) !== restoredTraceRetention.digest) {
    fail(`trace-retention ownership restored compiled source drifted: ${restoredTraceRetention.path}`);
  }
  for (const identity of LEGACY_TRACE_COMPACTION_HISTORICAL_TRANSITION.addedCompiledPaths) {
    const bytes = identity.path === restoredTraceRetention.path
      ? RESTORED_TRACE_RETENTION_COMPILED
      : readFileSync(resolve(canonicalRoot, identity.path));
    if (hashBytes(bytes) !== identity.digest) {
      fail(`legacy trace-compaction added compiled source drifted: ${identity.path}`);
    }
  }
  const environmentQuarantinePaths = validateEnvironmentQuarantineCompiledCoreJavaScriptPaths(paths);
  const decimalAdmissionIsolationPaths =
    validateDecimalAdmissionIsolationCompiledCoreJavaScriptPaths(environmentQuarantinePaths);
  const executionMetadataHardeningPaths =
    validateExecutionMetadataHardeningCompiledCoreJavaScriptPaths(decimalAdmissionIsolationPaths);
  const executionContextHardeningFormatPaths =
    validateExecutionContextHardeningFormatCompiledCoreJavaScriptPaths(executionMetadataHardeningPaths);
  const executionContextHardeningPaths =
    validateExecutionContextHardeningCompiledCoreJavaScriptPaths(executionContextHardeningFormatPaths);
  const executionContextIsolationPaths =
    validateExecutionContextIsolationCompiledCoreJavaScriptPaths(executionContextHardeningPaths);
  const traceRetentionRootPaths =
    validateTraceRetentionRootCompiledCoreJavaScriptPaths(executionContextIsolationPaths);
  const traceRetentionOwnershipPaths =
    reconstructTraceRetentionOwnershipCompiledCoreJavaScriptPaths(traceRetentionRootPaths);
  const traceCompactionPaths =
    reconstructLegacyTraceCompactionCompiledCoreJavaScriptPaths(traceRetentionOwnershipPaths);
  const historicalPaths = reconstructM4145CompiledCoreJavaScriptPaths(traceCompactionPaths);
  const overrides = scalarHelperHistoryOverrides(canonicalRoot, paths, historicalPaths);
  for (const reconstruction of POST_ENVIRONMENT_QUARANTINE_COMPILED_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-environment-quarantine compiled path is absent from M4.145: ${reconstruction.path}`);
    }
    overrides.set(
      reconstruction.path,
      reconstructHistoricalTransitionChain({
        currentSource: overrides.get(reconstruction.path) ??
          readFileSync(resolve(canonicalRoot, reconstruction.path)),
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `environment quarantine predecessor compiled ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [
          historicalTransitionStage({
            claim: reconstruction.claim,
            currentDigest: reconstruction.currentDigest,
            expectedDigest: reconstruction.expectedDigest,
            path: reconstruction.path,
            replacements: reconstruction.replacements,
          }),
        ],
      }),
    );
  }
  for (const reconstruction of POST_DECIMAL_ADMISSION_ISOLATION_COMPILED_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-decimal-admission-isolation compiled path is absent from M4.145: ${reconstruction.path}`);
    }
    overrides.set(
      reconstruction.path,
      reconstructHistoricalTransitionChain({
        currentSource:
          overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `decimal-admission isolation predecessor compiled ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [
          historicalTransitionStage({
            claim: reconstruction.claim,
            currentDigest: reconstruction.currentDigest,
            expectedDigest: reconstruction.expectedDigest,
            path: reconstruction.path,
            replacements: reconstruction.replacements,
          }),
        ],
      }),
    );
  }
  for (const reconstruction of POST_EXECUTION_METADATA_HARDENING_COMPILED_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-execution-metadata-hardening compiled path is absent from M4.145: ${reconstruction.path}`);
    }
    overrides.set(
      reconstruction.path,
      reconstructHistoricalTransitionChain({
        currentSource:
          overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `execution-metadata hardening predecessor compiled ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [
          historicalTransitionStage({
            claim: reconstruction.claim,
            currentDigest: reconstruction.currentDigest,
            expectedDigest: reconstruction.expectedDigest,
            path: reconstruction.path,
            replacements: reconstruction.replacements,
          }),
        ],
      }),
    );
  }
  for (const reconstruction of POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-execution-context-hardening-format compiled path is absent from M4.145: ${reconstruction.path}`);
    }
    overrides.set(
      reconstruction.path,
      reconstructHistoricalTransitionChain({
        currentSource:
          overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `execution-context hardening format predecessor compiled ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [
          historicalTransitionStage({
            claim: reconstruction.claim,
            currentDigest: reconstruction.currentDigest,
            expectedDigest: reconstruction.expectedDigest,
            path: reconstruction.path,
            replacements: reconstruction.replacements,
          }),
        ],
      }),
    );
  }
  for (const reconstruction of POST_EXECUTION_CONTEXT_HARDENING_COMPILED_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-execution-context-hardening compiled path is absent from M4.145: ${reconstruction.path}`);
    }
    overrides.set(
      reconstruction.path,
      reconstructHistoricalTransitionChain({
        currentSource:
          overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `execution-context hardening predecessor compiled ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [
          historicalTransitionStage({
            claim: reconstruction.claim,
            currentDigest: reconstruction.currentDigest,
            expectedDigest: reconstruction.expectedDigest,
            path: reconstruction.path,
            replacements: reconstruction.replacements,
          }),
        ],
      }),
    );
  }
  for (const reconstruction of POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-execution-context-isolation compiled path is absent from M4.145: ${reconstruction.path}`);
    }
    overrides.set(
      reconstruction.path,
      reconstructHistoricalTransitionChain({
        currentSource:
          overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `execution-context predecessor compiled ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [
          historicalTransitionStage({
            claim: reconstruction.claim,
            currentDigest: reconstruction.currentDigest,
            expectedDigest: reconstruction.expectedDigest,
            path: reconstruction.path,
            replacements: reconstruction.replacements,
          }),
        ],
      }),
    );
  }
  for (const reconstruction of POST_TRACE_RETENTION_ROOT_COMPILED_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-trace-retention-root compiled path is absent from M4.145: ${reconstruction.path}`);
    }
    overrides.set(
      reconstruction.path,
      reconstructHistoricalTransitionChain({
        currentSource:
          overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `b3d3f5fc successor compiled ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [
          historicalTransitionStage({
            claim: reconstruction.claim,
            currentDigest: reconstruction.currentDigest,
            expectedDigest: reconstruction.expectedDigest,
            path: reconstruction.path,
            replacements: reconstruction.replacements,
          }),
        ],
      }),
    );
  }
  for (const identity of [
    ...RUNTIME_TEXT_CACHE_TYPE_ONLY_COMPILED_IDENTITIES,
    ...TRACE_COMPACTION_TYPE_ONLY_COMPILED_IDENTITIES,
  ]) {
    if (!historicalPaths.includes(identity.path)) {
      fail(`runtime text cache type-only path is absent from M4.145: ${identity.path}`);
    }
    if (
      hashBytes(overrides.get(identity.path) ?? readFileSync(resolve(canonicalRoot, identity.path))) !==
      identity.digest
    ) {
      fail(`authenticated type-only compiled source drifted: ${identity.path}`);
    }
  }
  const runtimeTextCacheByPath = new Map(
    POST_RUNTIME_TEXT_CACHE_COMPILED_RECONSTRUCTIONS.map((reconstruction) => [reconstruction.path, reconstruction]),
  );
  for (const reconstruction of POST_TRACE_RETENTION_OWNERSHIP_COMPILED_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-trace-retention-ownership compiled path is absent from M4.145: ${reconstruction.path}`);
    }
    overrides.set(
      reconstruction.path,
      reconstructHistoricalTransitionChain({
        currentSource: overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `0df8834f successor compiled ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [
          historicalTransitionStage({
            claim: reconstruction.claim,
            currentDigest: reconstruction.currentDigest,
            expectedDigest: reconstruction.expectedDigest,
            path: reconstruction.path,
            replacements: reconstruction.replacements,
          }),
        ],
      }),
    );
  }
  for (const reconstruction of POST_LEGACY_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-legacy-trace-compaction compiled path is absent from M4.145: ${reconstruction.path}`);
    }
    overrides.set(
      reconstruction.path,
      reconstructHistoricalTransitionChain({
        currentSource: overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `F1 successor compiled ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [
          historicalTransitionStage({
            claim: reconstruction.claim,
            currentDigest: reconstruction.currentDigest,
            expectedDigest: reconstruction.expectedDigest,
            path: reconstruction.path,
            replacements: reconstruction.replacements,
          }),
        ],
      }),
    );
  }
  const chainedRuntimeTextCachePaths = new Set();
  for (const reconstruction of POST_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-trace-compaction compiled path is absent from M4.145: ${reconstruction.path}`);
    }
    const stages = [
      historicalTransitionStage({
        claim: reconstruction.claim,
        currentDigest: reconstruction.currentDigest,
        expectedDigest: reconstruction.expectedDigest,
        path: reconstruction.path,
        replacements: reconstruction.replacements,
      }),
    ];
    const runtimeTextCache = runtimeTextCacheByPath.get(reconstruction.path);
    if (runtimeTextCache !== undefined) {
      stages.push(
        historicalTransitionStage({
          claim: 'kern.runtime.text-cache.r0',
          currentDigest: runtimeTextCache.currentDigest,
          expectedDigest: runtimeTextCache.expectedDigest,
          path: runtimeTextCache.path,
          replacements: runtimeTextCache.replacements,
        }),
      );
      chainedRuntimeTextCachePaths.add(reconstruction.path);
    }
    overrides.set(
      reconstruction.path,
      reconstructHistoricalTransitionChain({
        currentSource: overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
        expectedTerminalDigest: runtimeTextCache?.expectedDigest ?? reconstruction.expectedDigest,
        milestone: `M4.145 compiled ${reconstruction.path}`,
        path: reconstruction.path,
        stages,
      }),
    );
  }
  for (const reconstruction of POST_RUNTIME_TEXT_CACHE_COMPILED_RECONSTRUCTIONS) {
    if (chainedRuntimeTextCachePaths.has(reconstruction.path)) continue;
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-runtime-text-cache compiled path is absent from M4.145: ${reconstruction.path}`);
    }
    const currentSource = overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path));
    if (hashBytes(currentSource) !== reconstruction.currentDigest) {
      fail(`post-runtime-text-cache compiled source drifted: ${reconstruction.path}`);
    }
    overrides.set(reconstruction.path, reconstructHistoricalSource({
      currentSource,
      expectedDigest: reconstruction.expectedDigest,
      milestone: `pre-runtime-text-cache compiled ${reconstruction.path}`,
      replacements: reconstruction.replacements,
    }));
  }
  for (const reconstruction of POST_TEXT_SPLICE_COMPILED_RUNTIME_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-text-splice compiled core path is absent from M4.145: ${reconstruction.path}`);
    }
    const currentSource = overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path));
    if (hashBytes(currentSource) !== reconstruction.currentDigest) {
      fail(`post-text-splice compiled core source drifted: ${reconstruction.path}`);
    }
    overrides.set(reconstruction.path, reconstructHistoricalSource({
      currentSource,
      expectedDigest: reconstruction.expectedDigest,
      milestone: `pre-text-splice compiled ${reconstruction.path}`,
      replacements: reconstruction.replacements,
    }));
  }
  const preM4171Sources = new Map();
  for (const reconstruction of POST_M4171_COMPILED_PARSER_STYLE_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-M4.171 compiled core path is absent from M4.145: ${reconstruction.path}`);
    }
    const historicalSource = reconstructHistoricalSource({
      currentSource: overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
      expectedDigest: reconstruction.expectedDigest,
      milestone: `pre-M4.171 compiled ${reconstruction.path}`,
      replacements: reconstruction.replacements,
    });
    preM4171Sources.set(reconstruction.path, historicalSource);
    overrides.set(reconstruction.path, historicalSource);
  }
  const preLambdaSources = new Map();
  for (const reconstruction of POST_LAMBDA_COMPILED_CONSTITUTION_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-lambda compiled core path is absent from M4.145: ${reconstruction.path}`);
    }
    const historicalSource = reconstructHistoricalSource({
      currentSource: preM4171Sources.get(reconstruction.path) ??
        overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
      expectedDigest: reconstruction.expectedDigest,
      milestone: `pre-lambda compiled ${reconstruction.path}`,
      replacements: reconstruction.replacements,
    });
    preLambdaSources.set(reconstruction.path, historicalSource);
    overrides.set(reconstruction.path, historicalSource);
  }
  const preEachSources = new Map();
  for (const reconstruction of POST_EACH_COMPILED_CONSTITUTION_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-each compiled core path is absent from M4.145: ${reconstruction.path}`);
    }
    const historicalSource = reconstructHistoricalSource({
      currentSource: preLambdaSources.get(reconstruction.path) ??
        overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
      expectedDigest: reconstruction.expectedDigest,
      milestone: `pre-each compiled ${reconstruction.path}`,
      replacements: reconstruction.replacements,
    });
    preEachSources.set(reconstruction.path, historicalSource);
    overrides.set(reconstruction.path, historicalSource);
  }
  const preBranchSources = new Map();
  for (const reconstruction of POST_BRANCH_COMPILED_CONSTITUTION_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-branch compiled core path is absent from M4.145: ${reconstruction.path}`);
    }
    const historicalSource = reconstructHistoricalSource({
      currentSource: preEachSources.get(reconstruction.path) ??
        overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
      expectedDigest: reconstruction.expectedDigest,
      milestone: `pre-branch compiled ${reconstruction.path}`,
      replacements: reconstruction.replacements,
    });
    preBranchSources.set(reconstruction.path, historicalSource);
    overrides.set(reconstruction.path, historicalSource);
  }
  for (const reconstruction of POST_M4153_COMPILED_CONSTITUTION_RECONSTRUCTIONS) {
    if (!historicalPaths.includes(reconstruction.path)) {
      fail(`post-M4.153 compiled core path is absent from M4.145: ${reconstruction.path}`);
    }
    overrides.set(reconstruction.path, reconstructHistoricalSource({
      currentSource: preBranchSources.get(reconstruction.path) ??
        overrides.get(reconstruction.path) ?? readFileSync(resolve(canonicalRoot, reconstruction.path)),
      expectedDigest: reconstruction.expectedDigest,
      milestone: `M4.145 compiled ${reconstruction.path}`,
      replacements: reconstruction.replacements,
    }));
  }
  return { canonicalRoot, overrides, paths: historicalPaths };
}

function localImplementationModules(directory = IMPLEMENTATION_ROOT, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`local implementation entry ${path} must not be a symlink`);
    if (entry.isDirectory()) localImplementationModules(path, output);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      output.push(relative(ROOT, path).split(sep).join('/'));
    }
  }
  return output;
}

export function digestCompiledCoreJavaScript() {
  const { canonicalRoot, paths } = compiledCoreJavaScriptPaths();
  return hashFramedFiles(canonicalRoot, paths);
}

export function digestM4145CompiledCoreJavaScript() {
  const { canonicalRoot, overrides, paths } = m4145CompiledCoreJavaScriptPaths();
  return hashFramedFiles(canonicalRoot, paths, overrides);
}

export function digestPreM4135CompiledCoreJavaScript() {
  const relativePath = 'kir-structural/expression.js';
  const currentSource = readFileSync(resolve(COMPILED_CORE_ROOT, relativePath));
  const historicalSource = reconstructHistoricalSource({
    currentSource,
    expectedDigest: 'b2f2383c9eb6ecfde619a3191dc539be1b33776af6f32f8c4001cb30449c2032',
    milestone: 'pre-M4.135 compiled structural expression',
    replacements: PRE_M4135_COMPILED_EXPRESSION_REPLACEMENTS,
  });
  const { canonicalRoot, overrides, paths } = m4145CompiledCoreJavaScriptPaths();
  overrides.set(relativePath, historicalSource);
  return hashFramedFiles(canonicalRoot, paths, overrides);
}

export function digestCoverageImplementationSources() {
  return hashFramedFiles(ROOT, localImplementationModules());
}

function currentDependencyReceipt() {
  return Object.freeze({
    compiledCoreDigest: digestCompiledCoreJavaScript(),
    coverageImplementationDigest: digestCoverageImplementationSources(),
  });
}

export function authenticateCoverageDependencies() {
  if (authenticatedDependencies !== undefined) return authenticatedDependencies;
  authenticatedDependencies = currentDependencyReceipt();
  return authenticatedDependencies;
}

export function requireAuthenticatedCoverageDependencies() {
  if (authenticatedDependencies === undefined) fail('coverage entry must authenticate dependencies first');
  return authenticatedDependencies;
}

export function verifyAuthenticatedCoverageDependencies(expected) {
  const current = currentDependencyReceipt();
  if (
    current.compiledCoreDigest !== expected.compiledCoreDigest ||
    current.coverageImplementationDigest !== expected.coverageImplementationDigest
  ) {
    fail('dependencies changed while loading the coverage implementation');
  }
}
