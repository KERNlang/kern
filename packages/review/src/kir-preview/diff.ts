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
  const remainingHead = [...head];
  const remainingBase: KirFact[] = [];
  for (const fact of base) {
    const index = remainingHead.findIndex((candidate) => candidate.value === fact.value);
    if (index < 0) remainingBase.push(fact);
    else remainingHead.splice(index, 1);
  }
  return { base: remainingBase, head: remainingHead };
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
  const remainingBase = [...base];
  const remainingHead = [...head];
  for (let baseIndex = remainingBase.length - 1; baseIndex >= 0; baseIndex -= 1) {
    const before = remainingBase[baseIndex] as KirFact;
    if (before.facet !== 'public-api' || before.contentIdentity === undefined) continue;
    const candidates = remainingHead.filter(
      (after) =>
        after.facet === 'public-api' &&
        after.moduleId === before.moduleId &&
        after.contentIdentity !== undefined &&
        after.contentIdentity === before.contentIdentity,
    );
    const reverseCandidates = remainingBase.filter(
      (candidate) => candidate.moduleId === before.moduleId && candidate.contentIdentity === before.contentIdentity,
    );
    if (candidates.length !== 1 || reverseCandidates.length !== 1) continue;
    const after = candidates[0] as KirFact;
    remainingBase.splice(baseIndex, 1);
    remainingHead.splice(remainingHead.indexOf(after), 1);
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
  return { findings, base: remainingBase, head: remainingHead };
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

  const renamed = renameFindings(
    changedBase.filter(
      (fact) =>
        !changedHead.some((candidate) => candidate.matchKey === fact.matchKey && candidate.facet === fact.facet),
    ),
    changedHead.filter(
      (fact) =>
        !changedBase.some((candidate) => candidate.matchKey === fact.matchKey && candidate.facet === fact.facet),
    ),
  );
  const consumedBase = new Set(
    changedBase.filter(
      (fact) =>
        fact.facet === 'public-api' &&
        !renamed.base.includes(fact) &&
        !changedHead.some((candidate) => candidate.matchKey === fact.matchKey && candidate.facet === fact.facet),
    ),
  );
  const consumedHead = new Set(
    changedHead.filter(
      (fact) =>
        fact.facet === 'public-api' &&
        !renamed.head.includes(fact) &&
        !changedBase.some((candidate) => candidate.matchKey === fact.matchKey && candidate.facet === fact.facet),
    ),
  );
  const findings = [...renamed.findings];
  const pairedHead = new Set<KirFact>();

  for (const before of changedBase) {
    if (consumedBase.has(before)) continue;
    const after = changedHead.find(
      (candidate) =>
        !consumedHead.has(candidate) &&
        !pairedHead.has(candidate) &&
        candidate.facet === before.facet &&
        candidate.matchKey === before.matchKey,
    );
    if (after) pairedHead.add(after);
    findings.push(makeFinding(before, after));
  }
  for (const after of changedHead) {
    if (!consumedHead.has(after) && !pairedHead.has(after)) findings.push(makeFinding(undefined, after));
  }

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
