import { compareCodePoints, deepFreeze } from './canonical.js';
import { findingFingerprint } from './fingerprint.js';
import type { CanonicalKirFactModel, KirFact } from './model.js';
import type { CanonicalKirChange, CanonicalKirFacet, CanonicalKirFinding } from './types.js';

type FindingInput = Omit<CanonicalKirFinding, 'fingerprint'>;

function finding(input: FindingInput): CanonicalKirFinding {
  return { ...input, fingerprint: findingFingerprint(input) };
}

function groupFacts(facts: readonly KirFact[]): Map<string, KirFact[]> {
  const groups = new Map<string, KirFact[]>();
  for (const fact of facts) {
    const key = `${fact.facet}\u0000${fact.matchKey}`;
    const group = groups.get(key);
    if (group) group.push(fact);
    else groups.set(key, [fact]);
  }
  for (const group of groups.values())
    group.sort((left, right) => compareCodePoints(left.value, right.value) || compareCodePoints(left.key, right.key));
  return groups;
}

function changeFor(facet: CanonicalKirFacet, before: boolean, after: boolean): CanonicalKirChange {
  if (!before) return facet === 'target-compatibility' ? 'target-profile-incompatibility' : 'added';
  if (!after) return facet === 'target-compatibility' ? 'target-profile-compatibility-restored' : 'removed';
  switch (facet) {
    case 'public-api':
      return 'signature-changed';
    case 'imports':
      return 'import-source-changed';
    case 'dependencies':
      return 'dependency-edge-changed';
    case 'capabilities':
      return 'capability-changed';
    case 'calls':
      return 'call-target-or-argument-shape-changed';
    case 'effects':
      return 'effect-changed';
    case 'structure':
      return 'structural-property-changed';
    default:
      return 'changed';
  }
}

function makeFinding(before: KirFact | undefined, after: KirFact | undefined): CanonicalKirFinding {
  const exemplar = after ?? (before as KirFact);
  const changedBoth = before !== undefined && after !== undefined;
  return finding({
    facet: exemplar.facet,
    moduleId: exemplar.moduleId,
    key: changedBoth ? before.matchKey : exemplar.key,
    change: changeFor(exemplar.facet, before !== undefined, after !== undefined),
    ...(before ? { before: before.display } : {}),
    ...(after ? { after: after.display } : {}),
  });
}

function cancelEqualValues(base: KirFact[], head: KirFact[]): { base: KirFact[]; head: KirFact[] } {
  const headByValue = new Map<string, KirFact[]>();
  for (const fact of head) {
    const matches = headByValue.get(fact.value);
    if (matches) matches.push(fact);
    else headByValue.set(fact.value, [fact]);
  }
  const matchedHead = new Set<KirFact>();
  const offsets = new Map<string, number>();
  const remainingBase: KirFact[] = [];
  for (const fact of base) {
    const matches = headByValue.get(fact.value);
    const offset = offsets.get(fact.value) ?? 0;
    const match = matches?.[offset];
    if (!match) remainingBase.push(fact);
    else {
      matchedHead.add(match);
      offsets.set(fact.value, offset + 1);
    }
  }
  return {
    base: remainingBase,
    head: head.filter((fact) => !matchedHead.has(fact)),
  };
}

function factGroups(facts: readonly KirFact[], keyOf: (fact: KirFact) => string): Map<string, KirFact[]> {
  const groups = new Map<string, KirFact[]>();
  for (const fact of facts) {
    const key = keyOf(fact);
    const group = groups.get(key);
    if (group) group.push(fact);
    else groups.set(key, [fact]);
  }
  return groups;
}

function renameFindings(
  base: KirFact[],
  head: KirFact[],
): {
  readonly findings: CanonicalKirFinding[];
  readonly base: KirFact[];
  readonly head: KirFact[];
} {
  const findings: CanonicalKirFinding[] = [];
  const identityKey = (fact: KirFact): string => `${fact.moduleId}\u0000${fact.contentIdentity ?? ''}`;
  const baseByIdentity = factGroups(
    base.filter((fact) => fact.facet === 'public-api' && fact.contentIdentity !== undefined),
    identityKey,
  );
  const headByIdentity = factGroups(
    head.filter((fact) => fact.facet === 'public-api' && fact.contentIdentity !== undefined),
    identityKey,
  );
  const consumedBase = new Set<KirFact>();
  const consumedHead = new Set<KirFact>();
  for (const [key, baseCandidates] of baseByIdentity) {
    const headCandidates = headByIdentity.get(key);
    if (baseCandidates.length !== 1 || headCandidates?.length !== 1) continue;
    const before = baseCandidates[0] as KirFact;
    const after = headCandidates[0] as KirFact;
    consumedBase.add(before);
    consumedHead.add(after);
    const input: FindingInput = {
      facet: 'public-api',
      moduleId: before.moduleId,
      key: `${before.key}->${after.key}`,
      change: 'removed-added-or-rename',
      before: before.display,
      after: after.display,
    };
    findings.push(finding(input));
  }
  return {
    findings,
    base: base.filter((fact) => !consumedBase.has(fact)),
    head: head.filter((fact) => !consumedHead.has(fact)),
  };
}

export function diffCanonicalKirFacts(
  baseModel: CanonicalKirFactModel,
  headModel: CanonicalKirFactModel,
): readonly CanonicalKirFinding[] {
  const baseGroups = groupFacts(baseModel.facts);
  const headGroups = groupFacts(headModel.facts);
  const keys = [...new Set([...baseGroups.keys(), ...headGroups.keys()])].sort(compareCodePoints);
  const changedBase: KirFact[] = [];
  const changedHead: KirFact[] = [];

  for (const key of keys) {
    const remaining = cancelEqualValues(baseGroups.get(key) ?? [], headGroups.get(key) ?? []);
    const pairCount = Math.min(remaining.base.length, remaining.head.length);
    for (let index = 0; index < pairCount; index += 1) {
      changedBase.push(remaining.base[index] as KirFact);
      changedHead.push(remaining.head[index] as KirFact);
    }
    changedBase.push(...remaining.base.slice(pairCount));
    changedHead.push(...remaining.head.slice(pairCount));
  }

  const matchKey = (fact: KirFact): string => `${fact.facet}\u0000${fact.matchKey}`;
  const headByMatch = factGroups(changedHead, matchKey);
  const headOffsets = new Map<string, number>();
  const pairedHead = new Set<KirFact>();
  const unmatchedBase: KirFact[] = [];
  const findings: CanonicalKirFinding[] = [];
  for (const before of changedBase) {
    const key = matchKey(before);
    const candidates = headByMatch.get(key);
    const offset = headOffsets.get(key) ?? 0;
    const after = candidates?.[offset];
    if (!after) unmatchedBase.push(before);
    else {
      headOffsets.set(key, offset + 1);
      pairedHead.add(after);
      findings.push(makeFinding(before, after));
    }
  }
  const unmatchedHead = changedHead.filter((fact) => !pairedHead.has(fact));
  const renamed = renameFindings(unmatchedBase, unmatchedHead);
  findings.push(...renamed.findings);
  for (const before of renamed.base) findings.push(makeFinding(before, undefined));
  for (const after of renamed.head) findings.push(makeFinding(undefined, after));

  findings.sort(
    (left, right) =>
      compareCodePoints(left.facet, right.facet) ||
      compareCodePoints(left.moduleId, right.moduleId) ||
      compareCodePoints(left.key, right.key) ||
      compareCodePoints(left.change, right.change) ||
      compareCodePoints(left.fingerprint, right.fingerprint),
  );
  return deepFreeze(findings);
}
