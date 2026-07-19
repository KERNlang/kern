import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanonicalValueDecodeError } from '../../packages/core/dist/canonical-value/types.js';
import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';
import { projectExpressionText } from '../../packages/core/dist/kir-structural/expression.js';
import { StructuralKirError } from '../../packages/core/dist/kir-structural/types.js';
import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { loadValidatedRuntimeConstitutionSource } from './coverage-catalog.mjs';
import { freezeFunctionFacts, validateFunctionFacts } from './coverage-facts.mjs';
import {
  requireAuthenticatedCoverageDependencies,
  verifyAuthenticatedCoverageDependencies,
} from './coverage-dependencies.mjs';
import {
  assertFamiliesCoverageClosed,
  coverageFamilyRegistrySource,
  STRUCTURAL_EXPRESSION_KINDS,
  validateCoverageFamilies,
} from './coverage-families.mjs';
import {
  analyzeProfileBlockersForFunction,
  canonicalProfileRowsForFunction,
  firstUnsupportedByAuthoredOrder,
  handlerChildProfilesForFunction,
  validateCoverageBase,
} from './coverage-profile.mjs';
import { canonicalizerPolicySource, loadCanonicalizerPolicy } from './policy.mjs';
import { loadCanonicalizerCoverageEvidence } from './coverage-composition.mjs';
import {
  canonicalizerFunctionCompletes,
  rankCanonicalizerFamilies,
} from './coverage-selection.mjs';
import { summarizeCoverageReceipt } from './coverage-summary.mjs';
import { CANONICALIZER_COMPOSITE_PATH } from './composition.mjs';
const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const POLICY_FORMAT = 'kern.kir-canonicalizer.coverage-policy.2';
const RECEIPT_FORMAT = 'kern.kir-canonicalizer.coverage-receipt.4';
const EXPRESSION_KINDS = STRUCTURAL_EXPRESSION_KINDS;
const AUTHENTICATED_DEPENDENCIES = requireAuthenticatedCoverageDependencies();
const COVERAGE_POLICY_SOURCE = readFileSync(new URL('./coverage-policy.json', import.meta.url));
const PROFILE_SOURCE = readFileSync(new URL('./coverage-profile.mjs', import.meta.url));
const EXPRESSION_CATALOG_SOURCE = readFileSync(resolve(ROOT, 'packages/core/src/kir-structural/expression.ts'));
const AUTHENTICATED_FUNCTION_FACTS = new WeakMap();
function fail(message) {
  throw new TypeError(`coverage policy rejection: ${message}`);
}
function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function record(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain record`);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string')) fail(`${label} contains symbol fields`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (actual.some((key) => descriptors[key].get || descriptors[key].set || !descriptors[key].enumerable)) {
    fail(`${label} must be inspectable plain data`);
  }
  const sorted = [...actual].sort();
  if (sorted.length !== keys.length || sorted.some((key, index) => key !== keys[index])) {
    fail(`${label} must contain exactly ${keys.join(',')}`);
  }
  return value;
}
function text(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be non-empty text`);
  return value;
}

function sortedUniqueText(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((entry, index) => text(entry, `${label}[${index}]`));
  const sorted = [...new Set(result)].sort(compareText);
  if (sorted.length !== result.length || sorted.some((entry, index) => entry !== result[index])) {
    fail(`${label} must be sorted and unique`);
  }
  return result;
}
function safePath(value, label) {
  const path = text(value, label);
  if (
    isAbsolute(path) ||
    /^[A-Za-z]:/u.test(path) ||
    path.includes('\\') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    !path.endsWith('.kern')
  ) {
    fail(`${label} must be a normalized relative .kern path`);
  }
  return path;
}
export function readCorpusMemberBytes(path, root = ROOT) {
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    fail('corpus root is missing');
  }
  const resolved = resolve(canonicalRoot, path);
  let stat;
  let real;
  try {
    stat = lstatSync(resolved);
    real = realpathSync(resolved);
  } catch {
    fail(`corpus member ${path} is missing`);
  }
  const relativePath = relative(canonicalRoot, real);
  const escaped = relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
  if (!stat.isFile() || real !== resolved || escaped) fail(`corpus member ${path} must be a contained regular file`);
  return readFileSync(resolved);
}

function validateCorpus(corpus, allowMissingCorpus) {
  if (!Array.isArray(corpus) || corpus.length === 0) fail('corpus must be a non-empty array');
  const paths = [];
  const result = corpus.map((entry, index) => {
    const item = record(entry, ['digest', 'path', 'sourceKind', 'tool'], `corpus[${index}]`);
    const path = safePath(item.path, `corpus[${index}].path`);
    if (path === CANONICALIZER_COMPOSITE_PATH) fail('generated composite cannot enter handwritten corpus');
    const expectedDigest = text(item.digest, `corpus[${index}].digest`);
    if (!/^[0-9a-f]{64}$/u.test(expectedDigest)) fail(`corpus[${index}].digest must be lowercase SHA-256`);
    const tool = text(item.tool, `corpus[${index}].tool`);
    if (!/^[a-z][a-z0-9-]*$/u.test(tool)) fail(`corpus[${index}].tool must be a stable id`);
    if (item.sourceKind !== 'handwritten') fail(`corpus[${index}].sourceKind must be handwritten`);
    paths.push(path);
    if (!allowMissingCorpus) {
      const sourceBytes = readCorpusMemberBytes(path);
      const source = sourceBytes.toString('utf8');
      if (/^\ufeff?[ \t]*#\s*(?:GENERATED FILE\b|@generated by kern\b)/imu.test(source)) {
        fail(`corpus member ${path} is generated`);
      }
      if (digest(sourceBytes) !== expectedDigest) fail(`corpus member ${path} digest drift`);
    }
    return { digest: expectedDigest, path, sourceKind: 'handwritten', tool };
  });
  const sorted = [...paths].sort(compareText);
  if (new Set(paths).size !== paths.length || sorted.some((path, index) => path !== paths[index])) {
    fail('corpus paths must be sorted and unique');
  }
  return result;
}

export function validateCoveragePolicy(input, options = {}) {
  const policy = record(input, ['base', 'corpus', 'families', 'format'], 'policy');
  if (policy.format !== POLICY_FORMAT) fail(`format must be ${POLICY_FORMAT}`);
  const baseInput = record(
    policy.base,
    ['expressionKinds', 'id', 'nodeKinds', 'promotions', 'propertyKeys'],
    'base',
  );
  if (!Array.isArray(baseInput.promotions)) fail('base.promotions must be an array');
  const promotions = baseInput.promotions.map((entry, index) => {
    const row = record(entry, ['family', 'selectionProvenanceDigest'], `base.promotions[${index}]`);
    const family = text(row.family, `base.promotions[${index}].family`);
    const selectionProvenanceDigest = text(
      row.selectionProvenanceDigest,
      `base.promotions[${index}].selectionProvenanceDigest`,
    );
    if (!/^[0-9a-f]{64}$/u.test(selectionProvenanceDigest)) fail('promotion digest must be lowercase SHA-256');
    return { family, selectionProvenanceDigest };
  });
  if (new Set(promotions.map(({ family }) => family)).size !== promotions.length) {
    fail('base.promotions must contain unique families');
  }
  const base = {
    expressionKinds: sortedUniqueText(baseInput.expressionKinds, 'base.expressionKinds'),
    id: text(baseInput.id, 'base.id'),
    nodeKinds: sortedUniqueText(baseInput.nodeKinds, 'base.nodeKinds'),
    promotions,
    propertyKeys: sortedUniqueText(baseInput.propertyKeys, 'base.propertyKeys'),
  };
  for (const kind of base.nodeKinds) {
    if (STRUCTURAL_KIR_NODE_CATALOG.get(kind)?.disposition !== 'structural-candidate') {
      fail(`base invents node kind ${kind}`);
    }
  }
  for (const kind of base.expressionKinds) {
    if (!EXPRESSION_KINDS.has(kind)) fail(`base invents expression kind ${kind}`);
  }
  validateCoverageBase(base);
  const corpus = validateCorpus(policy.corpus, options.allowMissingCorpus === true);
  const families = validateCoverageFamilies(policy.families, base);
  return { base, corpus, families, format: POLICY_FORMAT };
}

export function loadCoveragePolicy() {
  return validateCoveragePolicy(
    JSON.parse(COVERAGE_POLICY_SOURCE.toString('utf8')),
  );
}

export function assertCoverageClosed(policyInput, functions) {
  const policy = validateCoveragePolicy(policyInput, { allowMissingCorpus: true });
  return assertFamiliesCoverageClosed(policy, functions);
}

function canonicalRecord(value) {
  if (value?.tag !== 'record') return null;
  return new Map(value.value.map((entry) => [entry.key, entry.value]));
}

function collectExpressionKinds(value, output) {
  const root = canonicalRecord(value);
  const kind = root?.get('kind');
  const fields = root?.get('fields');
  if (root?.size === 2 && kind?.tag === 'text' && fields?.tag === 'record') {
    output.push(kind.value);
    collectNestedExpressions(fields, output);
    return;
  }
  collectNestedExpressions(value, output);
}

export function collectCanonicalExpressionKinds(value) {
  const output = [];
  collectExpressionKinds(value, output);
  return output;
}

function collectNestedExpressions(value, output) {
  if (value.tag === 'list') {
    for (const item of value.value) collectExpressionKinds(item, output);
  } else if (value.tag === 'record') {
    for (const entry of value.value) collectExpressionKinds(entry.value, output);
  } else if (value.tag === 'map') {
    for (const entry of value.value) {
      collectExpressionKinds(entry.key, output);
      collectExpressionKinds(entry.value, output);
    }
  }
}

function expressionSource(value, path) {
  if (typeof value === 'string') return value;
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.__expr === true &&
    typeof value.code === 'string' &&
    Reflect.ownKeys(value).length === 2
  ) {
    return value.code;
  }
  fail(`observed noncanonical expression payload at ${path}`);
}

function projectionCode(error) {
  if (error instanceof StructuralKirError || error instanceof CanonicalValueDecodeError) {
    return typeof error.code === 'string' ? error.code : 'projection-error';
  }
  throw error;
}

function withoutExcludedProperties(node) {
  const contract = STRUCTURAL_KIR_NODE_CATALOG.get(node.type);
  return {
    ...node,
    children: (node.children ?? []).map(withoutExcludedProperties),
    props: Object.fromEntries(
      Object.entries(node.props ?? {}).filter(
        ([key]) => !contract?.properties[key]?.disposition?.startsWith('excluded-'),
      ),
    ),
  };
}

function inspectFunction(root, path, tool, ordinal, base, canonicalizerPolicy) {
  const nodes = [];
  const expressions = [];
  const properties = [];
  const excludedProperties = [];
  const unsupported = [];
  let nodePosition = 0;
  function visit(node, nodePath) {
    const position = nodePosition++;
    nodes.push(node.type);
    const contract = STRUCTURAL_KIR_NODE_CATALOG.get(node.type);
    if (contract === undefined) fail(`observed unknown catalog node ${node.type}`);
    if (!base.nodeKinds.includes(node.type)) unsupported.push({ category: 'node', path: nodePath, position, value: node.type });
    for (const [key, value] of Object.entries(node.props ?? {})) {
      properties.push(`${node.type}.${key}`);
      const propertyContract = Object.hasOwn(contract.properties, key) ? contract.properties[key] : undefined;
      if (propertyContract === undefined) fail(`observed unknown property ${node.type}.${key}`);
      const omittedEmptyParameters = node.type === 'fn' && key === 'params' &&
        typeof value === 'string' && value.trim() === '';
      if (propertyContract.disposition.startsWith('excluded-') && !omittedEmptyParameters) {
        excludedProperties.push(`${node.type}.${key}`);
        unsupported.push({ category: 'excluded-property', path: `${nodePath}.${key}`, position, value: `${node.type}.${key}` });
      }
      if (propertyContract.disposition === 'lowered-expression') {
        let projected;
        try {
          projected = projectExpressionText(expressionSource(value, `${nodePath}.${key}`), `${nodePath}.${key}`);
        } catch (error) {
          const code = projectionCode(error);
          const blocker = `${node.type}.${key}:${code}`;
          excludedProperties.push(blocker);
          unsupported.push({ category: 'projection', path: `${nodePath}.${key}`, position, value: blocker });
        }
        const found = [];
        if (projected !== undefined) collectExpressionKinds(projected, found);
        for (const kind of found) {
          expressions.push(kind);
          if (!base.expressionKinds.includes(kind)) {
            unsupported.push({ category: 'expression', path: `${nodePath}.${key}`, position, value: kind });
          }
        }
      }
    }
    (node.children ?? []).forEach((child, index) => visit(child, `${nodePath}.children[${index}]`));
  }
  visit(root, '$');
  let profileRows;
  try {
    const projectionInput = excludedProperties.length === 0 ? root : withoutExcludedProperties(root);
    profileRows = canonicalProfileRowsForFunction(projectionInput, canonicalizerPolicy.kirLimits);
  } catch (error) {
    const code = projectionCode(error);
    excludedProperties.push(`projection.${code}`);
    unsupported.push({ category: 'projection', path: '$', position: nodePosition, value: code });
  }
  const profileAnalysis = analyzeProfileBlockersForFunction(
    root,
    base,
    canonicalizerPolicy.profileLimits,
    profileRows ?? null,
  );
  const profileBlockers = profileAnalysis.blockers;
  const displayName = typeof root.props?.name === 'string' ? root.props.name : `fn-${ordinal}`;
  return {
    excludedProperties: [...new Set(excludedProperties)].sort(compareText),
    expressionKinds: [...new Set(expressions)].sort(compareText),
    expressionOccurrences: expressions.toSorted(compareText),
    firstUnsupported: firstUnsupportedByAuthoredOrder(unsupported, profileAnalysis),
    handlerChildProfiles: handlerChildProfilesForFunction(root),
    id: `${path}#${ordinal}:${displayName}`,
    nodeKinds: [...new Set(nodes)].sort(compareText),
    nodeOccurrences: nodes.toSorted(compareText),
    profileBlockers,
    profileRows: profileRows ?? null,
    propertyKeys: [...new Set(properties)].sort(compareText),
    propertyOccurrences: properties.toSorted(compareText),
    tool,
  };
}
export function selectCanonicalizerTranche(policyInput, functions) {
  const authenticatedPolicyDigest = AUTHENTICATED_FUNCTION_FACTS.get(functions);
  if (authenticatedPolicyDigest === undefined) fail('function facts require authenticated measurement');
  validateFunctionFacts(functions);
  const profileLimits = loadCanonicalizerPolicy().profileLimits;
  const policy = assertCoverageClosed(policyInput, functions);
  if (authenticatedPolicyDigest !== digest(JSON.stringify(policy))) fail('function facts require authenticated policy');
  return rankCanonicalizerFamilies(policy, functions, profileLimits);
}
export function measureCanonicalizerCoverage(policyInput) {
  verifyAuthenticatedCoverageDependencies(AUTHENTICATED_DEPENDENCIES);
  const evidence = loadCanonicalizerCoverageEvidence();
  const policy = policyInput === undefined ? loadCoveragePolicy() : validateCoveragePolicy(policyInput);
  for (const promotion of policy.base.promotions) {
    if (
      promotion.family !== evidence.selectionProvenance.record.snapshot.selection.id ||
      promotion.selectionProvenanceDigest !== evidence.selectionProvenance.digest
    ) fail('base promotion must cite the authenticated selection provenance');
  }
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  const functions = [];
  for (const member of policy.corpus) {
    const sourceBytes = readCorpusMemberBytes(member.path);
    if (digest(sourceBytes) !== member.digest) fail(`corpus member ${member.path} changed during measurement`);
    const source = sourceBytes.toString('utf8');
    const parsed = parseDocumentWithDiagnostics(source);
    const errors = parsed.diagnostics.filter(({ severity }) => severity === 'error');
    if (errors.length > 0) fail(`corpus member ${member.path} has parse errors`);
    (parsed.root.children ?? []).forEach((root, ordinal) => {
      if (root.type === 'fn') {
        functions.push(inspectFunction(root, member.path, member.tool, ordinal, policy.base, canonicalizerPolicy));
      }
    });
  }
  functions.sort((left, right) => compareText(left.id, right.id));
  freezeFunctionFacts(functions);
  AUTHENTICATED_FUNCTION_FACTS.set(functions, digest(JSON.stringify(policy)));
  const selection = selectCanonicalizerTranche(policy, functions);
  const constitution = loadValidatedRuntimeConstitutionSource();
  const familyRegistry = coverageFamilyRegistrySource();
  const boundCanonicalizerPolicySource = canonicalizerPolicySource();
  const baseProfile = {
    baseNodeKinds: new Set(policy.base.nodeKinds),
    candidateNodeKinds: new Set(),
    expressionKinds: new Set(policy.base.expressionKinds),
    nodeKinds: new Set(policy.base.nodeKinds),
    propertyKeys: new Set(),
  };
  const receipt = {
    base: policy.base,
    baseCompleteFunctions: functions.filter((fn) =>
      canonicalizerFunctionCompletes(baseProfile, fn, canonicalizerPolicy.profileLimits),
    ).length,
    catalogDigest: digest(constitution),
    canonicalizerDigest: digest(evidence.source),
    canonicalizerPolicyDigest: digest(boundCanonicalizerPolicySource),
    compiledCoreDigest: AUTHENTICATED_DEPENDENCIES.compiledCoreDigest,
    composition: evidence.composition,
    corpus: policy.corpus,
    corpusDigest: digest(JSON.stringify(policy.corpus)),
    coverageImplementationDigest: AUTHENTICATED_DEPENDENCIES.coverageImplementationDigest,
    coveragePolicyDigest: digest(COVERAGE_POLICY_SOURCE),
    familyRegistryDigest: digest(familyRegistry),
    expressionCatalogDigest: digest(EXPRESSION_CATALOG_SOURCE),
    format: RECEIPT_FORMAT,
    functionFactsDigest: digest(JSON.stringify(functions)),
    functions,
    implementationSelectionProvenance: evidence.implementationSelectionProvenance,
    policyDigest: digest(JSON.stringify(policy)),
    profileDigest: digest(PROFILE_SOURCE),
    selection,
    selectionProvenance: evidence.selectionProvenance,
  };
  verifyAuthenticatedCoverageDependencies(AUTHENTICATED_DEPENDENCIES);
  return receipt;
}

export function summarizeCanonicalizerCoverage(receipt = measureCanonicalizerCoverage()) {
  return summarizeCoverageReceipt(receipt);
}
